/*
 * Client-side password change for Boundary B.
 *
 * PQchangePassword is the non-interactive form of psql's \password command.
 * libpq encrypts with PQencryptPasswordConn and the server's password_encryption.
 * The plaintext password is read from stdin and is not an argument.
 * Operator connections require sslmode=verify-full, gssencmode=disable, and the
 * approved CA. A missing operator TLS mode never falls back to PQconnectdb("").
 *
 * Compile: cc -O2 -Wall -Wextra -Werror -o pq-change-password pq-change-password.c -I/usr/include/postgresql -lpq
 */
#define _GNU_SOURCE

#include <postgresql/libpq-fe.h>

#include <ctype.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static void wipe(void *pointer, size_t bytes) {
    if (pointer != NULL && bytes > 0) {
        explicit_bzero(pointer, bytes);
    }
}

static void say(const char *word) {
    fputs(word, stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

static int role_name_ok(const char *role) {
    size_t length;
    size_t index;

    if (role == NULL) {
        return 0;
    }
    length = strlen(role);
    if (length < 1 || length > 63) {
        return 0;
    }
    for (index = 0; index < length; index++) {
        unsigned char character = (unsigned char)role[index];
        if (character != '_' && !isalnum(character)) {
            return 0;
        }
    }
    return 1;
}

static int signal_ready(const char *path) {
    FILE *file;

    file = fopen(path, "w");
    if (file == NULL) {
        return 0;
    }
    if (fputs("ready\n", file) < 0) {
        fclose(file);
        return 0;
    }
    return fclose(file) == 0;
}

static int wait_for_release(const char *path) {
    int attempt;

    for (attempt = 0; attempt < 600; attempt++) {
        struct timespec delay = {0, 50000000L};

        if (access(path, R_OK) == 0) {
            return 1;
        }
        nanosleep(&delay, NULL);
    }
    return 0;
}

static int read_password(char *buffer, size_t capacity) {
    size_t length = 0;

    while (length + 1 < capacity) {
        size_t got = fread(buffer + length, 1, 1, stdin);
        if (got == 0) {
            break;
        }
        if (buffer[length] == '\n' || buffer[length] == '\r') {
            break;
        }
        length++;
    }
    if (length < 24 || length + 1 >= capacity) {
        wipe(buffer, capacity);
        return 0;
    }
    buffer[length] = '\0';
    for (size_t index = 0; index < length; index++) {
        unsigned char character = (unsigned char)buffer[index];
        if (character != '-' && character != '_' && !isalnum(character)) {
            wipe(buffer, capacity);
            return 0;
        }
    }
    return 1;
}

static int conninfo_value_ok(const char *value) {
    const char *cursor;

    if (value == NULL || value[0] == '\0') {
        return 0;
    }
    for (cursor = value; *cursor != '\0'; cursor++) {
        unsigned char character = (unsigned char)*cursor;
        if (character <= ' ' || character == '\'' || character == '"' || character == '\\') {
            return 0;
        }
    }
    return 1;
}

static int path_inside(const char *parent, const char *child) {
    size_t length;

    if (parent == NULL || child == NULL || parent[0] != '/') {
        return 1;
    }
    length = strlen(parent);
    while (length > 1 && parent[length - 1] == '/') {
        length--;
    }
    if (strncmp(child, parent, length) != 0) {
        return 0;
    }
    return child[length] == '\0' || child[length] == '/';
}

static int directory_is_unsafe(const char *dir) {
    struct stat st;

    if (lstat(dir, &st) != 0) {
        return 1;
    }
    if (S_ISLNK(st.st_mode) || !S_ISDIR(st.st_mode)) {
        return 1;
    }
    if ((st.st_mode & 022) != 0 && !((st.st_mode & S_ISVTX) && st.st_uid == 0)) {
        return 1;
    }
    if (st.st_uid != 0 && st.st_uid != getuid()) {
        return 1;
    }
    return 0;
}

static int parents_are_safe(const char *file_path) {
    char dir[PATH_MAX];
    size_t length;

    length = strlen(file_path);
    if (length < 2 || length >= sizeof(dir)) {
        return 0;
    }
    memcpy(dir, file_path, length + 1);
    for (;;) {
        char *slash = strrchr(dir, '/');

        if (slash == NULL) {
            return 0;
        }
        if (slash == dir) {
            return directory_is_unsafe("/") ? 0 : 1;
        }
        *slash = '\0';
        if (dir[0] == '\0' || directory_is_unsafe(dir)) {
            return 0;
        }
    }
}

static int ca_file_ok(const char *root) {
    struct stat st;
    char resolved[PATH_MAX];
    const char *repo;
    const char *artifacts;

    if (root == NULL || root[0] != '/') {
        return 0;
    }
    if (lstat(root, &st) != 0) {
        return 0;
    }
    if (S_ISLNK(st.st_mode) || !S_ISREG(st.st_mode)) {
        return 0;
    }
    if (st.st_uid != getuid() || (st.st_mode & 077) != 0 || access(root, R_OK) != 0) {
        return 0;
    }
    if (realpath(root, resolved) == NULL || strcmp(resolved, root) != 0) {
        return 0;
    }
    if (!parents_are_safe(root)) {
        return 0;
    }
    repo = getenv("SA360_BOUNDARY_B_REPO_ROOT");
    artifacts = getenv("SA360_BOUNDARY_B_ARTIFACTS");
    if (repo == NULL || repo[0] == '\0' || artifacts == NULL || artifacts[0] == '\0') {
        return 0;
    }
    if (path_inside(repo, root) || path_inside(artifacts, root)) {
        return 0;
    }
    return 1;
}

static int build_verify_conninfo(char *dest, size_t capacity) {
    const char *host = getenv("PGHOST");
    const char *hostaddr = getenv("PGHOSTADDR");
    const char *port = getenv("PGPORT");
    const char *user = getenv("PGUSER");
    const char *database = getenv("PGDATABASE");
    const char *root = getenv("PGSSLROOTCERT");
    int written;

    if (!conninfo_value_ok(host) || !conninfo_value_ok(port) || !conninfo_value_ok(user) || !conninfo_value_ok(database) || !conninfo_value_ok(root)) {
        return 0;
    }
    if (!ca_file_ok(root)) {
        return 0;
    }
    if (hostaddr != NULL && hostaddr[0] != '\0') {
        if (!conninfo_value_ok(hostaddr)) {
            return 0;
        }
        written = snprintf(dest, capacity, "host=%s hostaddr=%s port=%s user=%s dbname=%s sslmode=verify-full gssencmode=disable sslrootcert=%s", host, hostaddr, port, user, database, root);
    } else {
        written = snprintf(dest, capacity, "host=%s port=%s user=%s dbname=%s sslmode=verify-full gssencmode=disable sslrootcert=%s", host, port, user, database, root);
    }
    return written > 0 && (size_t)written < capacity;
}

static int production_allowed(void) {
    const char *flag = getenv("SA360_BOUNDARY_B_ALLOW_PRODUCTION");

    return flag != NULL && strcmp(flag, "yes") == 0;
}

static int build_disposable_conninfo(char *dest, size_t capacity) {
    const char *host = getenv("PGHOST");
    const char *hostaddr = getenv("PGHOSTADDR");
    const char *port = getenv("PGPORT");
    const char *user = getenv("PGUSER");
    const char *database = getenv("PGDATABASE");
    int written;

    if (production_allowed()) {
        return 0;
    }
    if (!conninfo_value_ok(host) || strcmp(host, "127.0.0.1") != 0 || !conninfo_value_ok(port) || !conninfo_value_ok(user) || !conninfo_value_ok(database)) {
        return 0;
    }
    if (hostaddr != NULL && hostaddr[0] != '\0' && strcmp(hostaddr, "127.0.0.1") != 0) {
        return 0;
    }
    written = snprintf(dest, capacity, "host=%s port=%s user=%s dbname=%s sslmode=disable gssencmode=disable", host, port, user, database);
    return written > 0 && (size_t)written < capacity;
}

static int encryption_is_md5(PGconn *connection) {
    PGresult *result;
    const char *value;

    result = PQexec(connection, "SHOW password_encryption");
    if (result == NULL || PQresultStatus(result) != PGRES_TUPLES_OK || PQntuples(result) != 1) {
        if (result != NULL) {
            PQclear(result);
        }
        return 0;
    }
    value = PQgetvalue(result, 0, 0);
    if (value == NULL || strcmp(value, "md5") != 0) {
        PQclear(result);
        return 0;
    }
    PQclear(result);
    return 1;
}

static int transport_ok(PGconn *connection, int require_ssl) {
    const char *host;

    if (connection == NULL) {
        return 0;
    }
    if (PQgssEncInUse(connection) != 0) {
        return 0;
    }
    if (require_ssl) {
        return PQsslInUse(connection) == 1;
    }
    host = PQhost(connection);
    if (host == NULL || strcmp(host, "127.0.0.1") != 0) {
        return 0;
    }
    return PQsslInUse(connection) == 0;
}

int main(int argc, char **argv) {
    const char *role;
    const char *ready_path;
    const char *release_path;
    char password[256];
    char conninfo[PATH_MAX + 512];
    const char *tls_mode;
    int require_ssl = 0;
    PGconn *connection;
    PGresult *changed;
    struct rlimit no_core = {0, 0};

    (void)argv;
    setrlimit(RLIMIT_CORE, &no_core);
    if (argc != 1) {
        return 2;
    }
    if (getenv("PGPASSWORD") != NULL) {
        return 2;
    }
    role = getenv("SA360_PASSWORD_ROLE");
    if (!role_name_ok(role)) {
        return 2;
    }

    tls_mode = getenv("SA360_BOUNDARY_B_TLS");
    if (tls_mode != NULL && strcmp(tls_mode, "verify-full") == 0) {
        require_ssl = 1;
        if (!build_verify_conninfo(conninfo, sizeof(conninfo))) {
            say("refused");
            return 3;
        }
    } else if (tls_mode != NULL && strcmp(tls_mode, "disposable-loopback") == 0) {
        if (!build_disposable_conninfo(conninfo, sizeof(conninfo))) {
            say("refused");
            return 3;
        }
    } else {
        say("refused");
        return 3;
    }

    ready_path = getenv("SA360_PQ_READY_FILE");
    release_path = getenv("SA360_PQ_RELEASE_FILE");
    if ((ready_path != NULL && ready_path[0] != '\0') || (release_path != NULL && release_path[0] != '\0')) {
        if (ready_path == NULL || release_path == NULL || ready_path[0] == '\0' || release_path[0] == '\0') {
            say("refused");
            return 3;
        }
        if (!signal_ready(ready_path) || !wait_for_release(release_path)) {
            say("refused");
            return 3;
        }
    }

    memset(password, 0, sizeof(password));
    if (!read_password(password, sizeof(password))) {
        say("refused");
        return 3;
    }

    connection = PQconnectdb(conninfo);
    if (connection == NULL || PQstatus(connection) != CONNECTION_OK || !transport_ok(connection, require_ssl) || !encryption_is_md5(connection)) {
        if (connection != NULL) {
            PQfinish(connection);
        }
        wipe(password, sizeof(password));
        say("refused");
        return 3;
    }

    changed = PQchangePassword(connection, role, password);
    wipe(password, sizeof(password));
    if (changed == NULL || PQresultStatus(changed) != PGRES_COMMAND_OK) {
        if (changed != NULL) {
            PQclear(changed);
        }
        PQfinish(connection);
        say("fail");
        return 1;
    }
    PQclear(changed);
    PQfinish(connection);
    say("ok");
    return 0;
}
