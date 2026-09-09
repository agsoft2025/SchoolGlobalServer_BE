import jwt from "jsonwebtoken";
import usermodel from "../models/auth.model.js";

// Super-Admin-only gate for the SMS Template Master CRUD.
//
// Unlike verifyLocationAccess.js this has NO internal-service-key bypass:
// managing template definitions is strictly a human Super Admin action.
// Server-to-server reads use verifyInternalService.js on the /internal/* routes.
// process.env is read inside the handler (not at module load) because this file
// can be evaluated before dotenv.config() in the ESM import graph.
const verifySuperAdmin = async (request, reply) => {
  const authHeader = request.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return reply.code(401).send({ success: false, message: "Access token required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "SUPER ADMIN") {
      return reply.code(403).send({ success: false, message: "Super Admin access required" });
    }

    const userExist = await usermodel.findById(decoded.id);
    if (!userExist) {
      return reply.code(403).send({ success: false, message: "Invalid credentials (user deleted)" });
    }

    request.user = { id: decoded.id, username: decoded.username, role: decoded.role };
  } catch (error) {
    return reply.code(403).send({ success: false, message: "Invalid token" });
  }
};

export default verifySuperAdmin;
