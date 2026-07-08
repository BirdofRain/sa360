/** Loaded before other test imports so redis/db use test-mode settings. */
process.env.NODE_ENV ??= "test";
