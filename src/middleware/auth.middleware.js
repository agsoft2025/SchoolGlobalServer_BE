import usermodel from "../models/auth.model.js";
const JWT_SECRET = process.env.JWT_SECRET;
import jwt from "jsonwebtoken"

const authenticateToken = async (request, reply) => {
  const authHeader = request.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return reply.code(401).send({ message: "Access token required" });
  }

  try {
    const user = jwt.verify(token, JWT_SECRET);
    const userExist = await usermodel.findById(user.id);
    if (!userExist) {
      return reply.code(403).send({
        success: false,
        message: "Invalid credentials (user deleted)",
      });
    }

    request.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };

  } catch (error) {
    return reply.code(403).send({ message: "Invalid token" });
  }
};


export default authenticateToken 