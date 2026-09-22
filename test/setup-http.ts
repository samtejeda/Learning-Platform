if (process.env.INTEGRATION_TESTS !== "1") {
  throw new Error(
    "HTTP tests seed accounts in the database from .env.local. Run `pnpm test:http` (sets INTEGRATION_TESTS=1).",
  );
}
