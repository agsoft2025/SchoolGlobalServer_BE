import Fastify from "fastify";
import { connectDB } from "./config/db.js";
import locationRoutes from "./routes/location.routes.js";
import indexRoutes from "./routes/index.routes.js";
import paymentFunction from "./routes/payment.route.js";
import subscriberFunction from "./routes/subscribers.route.js";
import authFunction from "./routes/auth.route.js";
import smsTemplateRoutes from "./routes/smsTemplate.route.js";
import senderIdRoutes from "./routes/senderId.route.js";
import schoolSmsConfigRoutes from "./routes/schoolSmsConfig.route.js";
import { seedSmsTemplates } from "./service/smsTemplateSeed.js";
import { seedSenderAndSchoolConfig } from "./service/schoolSmsConfigSeed.js";
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

  // One-time idempotent seed of the currently-approved SCHOOL SMS templates.
  await seedSmsTemplates();

  // Idempotent rollout seed for school-wise Sender ID + template isolation
  // (default sender header, senderId backfill, per-location config). Runs after
  // the template seed so the default templates are present to whitelist.
  await seedSenderAndSchoolConfig();

  // Register Routes
  fastify.register(indexRoutes, { prefix: "/" });
  fastify.register(locationRoutes, { prefix: "/api/location" });
  fastify.register(paymentFunction, { prefix: "/api/payment" })
  fastify.register(subscriberFunction, { prefix: "/api/subscribers" })
  fastify.register(authFunction, { prefix: "/api/login" })
  fastify.register(smsTemplateRoutes, { prefix: "/api/sms-templates" })
  fastify.register(senderIdRoutes, { prefix: "/api/sender-ids" })
  fastify.register(schoolSmsConfigRoutes, { prefix: "/api/school-sms-config" })

  return fastify;
};
