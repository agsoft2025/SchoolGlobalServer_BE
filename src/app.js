import Fastify from "fastify";
import { connectDB } from "./config/db.js";
import locationRoutes from "./routes/location.routes.js";
import indexRoutes from "./routes/index.routes.js";
import paymentFunction from "./routes/payment.route.js";
import subscriberFunction from "./routes/subscribers.route.js";
import authFunction from "./routes/auth.route.js";
import cors from "@fastify/cors"

export const buildApp = async () => {
  const fastify = Fastify();
  await fastify.register(cors, {
    origin: "*",     // allow all origins
    methods: ["GET", "POST", "PUT","PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  fastify.addHook("onRequest", async(request,reply)=>{
    fastify.log.info({
      method:request.method,
      url:request.url,
      params:request.params,
      query:request.query
    },"Incoming Request")
  })
  // Connect Database
  await connectDB();

  // Register Routes
  fastify.register(indexRoutes, { prefix: "/" });
  fastify.register(locationRoutes, { prefix: "/api/location" });
  fastify.register(paymentFunction, { prefix: "/api/payment" })
  fastify.register(subscriberFunction, { prefix: "/api/subscribers" })
  fastify.register(authFunction, { prefix: "/api/login" })

  return fastify;
};
