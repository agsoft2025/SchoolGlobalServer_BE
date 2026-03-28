import usermodel from "../models/auth.model.js";
import bcrypt from 'bcrypt'
import jwt from "jsonwebtoken"

export default async function authRoutes(fastify) {
//  fastify.get("/",async(req,res)=>{
//      const users = await usermodel.find({});
//         if (users.length === 0) {
//             const hashedPassword = await bcrypt.hash("superadmin@123", 10);

//             const newUser = new usermodel({
//                 username: "Super Admin",
//                 fullname: "Super Admin",
//                 password: hashedPassword,
//                 role: "ADMIN",
//             });

//             await newUser.save();
//             res.status(200).send({ success: true, message: "admin created successfully" })
//         } else {
//             return res.status(200).send({ success: true, message: "user already created" })
//         }
//  })

 fastify.post("/",async(req,reply)=>{
    const { username, password } = req.body
     try {
        const userData = await usermodel.findOne({username});
        console.log("<><>userData",userData);
        
        if(!userData){
            return reply.code(200).send({status:false,statuscode:403,message:"incorrect user name"})
        }
        const passwordMatch = await bcrypt.compare(password,userData.password);
        
        if(!passwordMatch){
             return reply.code(200).send({status:false,statuscode:403,message:"incorrect password"})
        }
        const {fullname,role} = userData
        const token = jwt.sign({id:userData._id,username,role},process.env.JWT_SECRET,{expiresIn:'30d'});
        reply.code(200).send({status:true,user:{username:userData.username,fullname,role},token})
     } catch (error) {
        return reply.code(500).send(error.message)
     }
      
 })
}