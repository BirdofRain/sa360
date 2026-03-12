import dotenv from "dotenv";
import { buildApp } from "./app.js";

dotenv.config();

const port = Number(process.env.PORT || 3000);
const host = "0.0.0.0";

const app = await buildApp();

app
  .listen({ port, host })
  .then(() => {
    console.log(`API listening on http://${host}:${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });