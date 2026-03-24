import dotenv from "dotenv";
dotenv.config();

import { buildApp } from "./src/app.js";

const startServer = async () => {
  const app = await buildApp();

  try {
    await app.listen({ port: process.env.PORT, host: "0.0.0.0" });
    console.log(`🚀 Server running on http://localhost:${process.env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

startServer();
