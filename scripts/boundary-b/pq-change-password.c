/*
 * Client-side password change for Boundary B.
 *
 * PQchangePassword is the non-interactive form of psql's \password command.
 * libpq encrypts with PQencryptPasswordConn and the server's password_encryption.
 * The plaintext password is read from stdin and is not an argument.
 *
 * Compile: cc -O2 -Wall -Wextra -Werror -o pq-change-password pq-change-password.c -I/usr/include/postgresql -lpq
 */
#define _GNU_SOURCE

#include <postgresql/libpq-fe.h>

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
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
    if (access(root, R_OK) != 0) {
        return 0;
    }
    if (hostaddr != NULL && hostaddr[0] != '\0') {
        if (!conninfo_value_ok(hostaddr)) {
            return 0;
        }
        written = snprintf(dest, capacity, "host=%s hostaddr=%s port=%s user=%s dbname=%s sslmode=verify-full sslrootcert=%s", host, hostaddr, port, user, database, root);
    } else {
        written = snprintf(dest, capacity, "host=%s port=%s user=%s dbname=%s sslmode=verify-full sslrootcert=%s", host, port, user, database, root);
    }
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

int main(int argc, char **argv) {
    const char *role;
    const char *ready_path;
    const char *release_path;
    char password[256];
    char conninfo[1280];
    const char *tls_mode;
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

    tls_mode = getenv("SA360_BOUNDARY_B_TLS");
    if (tls_mode != NULL && strcmp(tls_mode, "verify-full") == 0) {
        if (!build_verify_conninfo(conninfo, sizeof(conninfo))) {
            say("refused");
            return 3;
        }
    } else if (tls_mode != NULL && tls_mode[0] != '\0') {
        say("refused");
        return 3;
    } else {
        conninfo[0] = '\0';
    }

    memset(password, 0, sizeof(password));
    if (!read_password(password, sizeof(password))) {
        say("refused");
        return 3;
    }

    connection = conninfo[0] == '\0' ? PQconnectdb("") : PQconnectdb(conninfo);
    if (connection == NULL || PQstatus(connection) != CONNECTION_OK || !encryption_is_md5(connection)) {
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
