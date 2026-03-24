export default async function indexRoutes(fastify) {
 fastify.get("/",(req,res)=>{
   res.status(200).send({status:true,message:"server running successfully"})
 })
}