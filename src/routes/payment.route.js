
import { request } from "http";
import parentsubscriptionModel from "../models/parentsubscription.model.js";
import { createOrder } from "../services/razorpay.service.js";
import getExpiryDate from "../utils/getExpirydate.js";
import crypto from 'crypto'
import parentsubscriptionHistoryModel from "../models/parentsubscriptionHistory.model.js";
import { Location } from "../models/location.model.js";

export default async function paymentFunction(fastify) {
    fastify.post('/create', async (request, reply) => {
        try {
            const { amount, shortReceipt, studentData, locationId, subscription_type, student_info } = request.body;

            const studentId = studentData._id;
            const today = new Date();

            // STUDENT DATA
            const student_data = {
                _id: student_info._id,
                registration_number: student_info.registration_number,
                student_name: student_info.student_name,
                mother_name: student_info.mother_name,
                father_name: student_info.father_name,
                contact_number: student_info.contact_number,
                date_of_birth: student_info.date_of_birth,
                gender: student_info.gender,
                nationality: student_info.nationality,
                blood_group: student_info.blood_group,
                subscription: student_info.subscription,
                class_info: student_info.class_info,
                location_id: student_info.location_id,
                user_id: student_info.user_id
            }
            
            // 1️⃣ Check if valid active subscription exists
            const activeSub = await parentsubscriptionModel.findOne({
                student_id: studentId,
                payment_status: "SUCCESS",
                is_active: true,
                student_info:student_data,
                expire_date: { $gte: today } // expire future
            });

            if (activeSub) {
                // Calculate remaining days
                const diffMs = new Date(activeSub.expire_date) - today;
                const remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

                return reply.code(200).send({
                    success: true,
                    subscription: true,
                    message: `You already have an active subscription. ${remainingDays} day(s) remaining.`,
                    subscription: activeSub
                });
            }

            // 2️⃣ No active plan → Create order
            const locationData = await Location.findById(locationId)
            
            const order = await createOrder(locationData?.amount || 100, shortReceipt);

            const orderData = {
                student_id: studentId,
                location_id: locationId,
                subscription_type,
                amount,
                razorpay_order_id: order.id,
                student_info: student_data
            };

            const data = await parentsubscriptionModel.create(orderData);

            return reply.code(200).send({
                success: true,
                order
            });

        } catch (error) {
            return reply.code(500).send({
                status: false,
                message: "Internal Server Error",
                error: error.message
            });
        }
    });

    fastify.post('/verify', async (request, reply) => {
        try {
            const {
                razorpay_order_id,
                razorpay_payment_id,
                razorpay_signature,
                studentId,
                subscription_type = "YEARLY",
                location_id,
                amount
            } = request.body;

            // 1. Verify Signature
            const body = razorpay_order_id + "|" + razorpay_payment_id;
            const expectedSignature = crypto
                .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
                .update(body.toString())
                .digest("hex");

            const today = new Date();
            const expire = getExpiryDate(subscription_type);

            if (expectedSignature !== razorpay_signature) {
                await parentsubscriptionModel.findOneAndUpdate(
                    { razorpay_order_id },
                    { payment_status: "FAILED", razorpay_payment_id }
                );

                // HISTORY INSERT
                await parentsubscriptionHistoryModel.create({
                    student_id: studentId,
                    location_id,
                    subscription_type,
                    amount,
                    payment_status: "FAILED",
                    activated_at: today,
                    expired_at: expire,
                    razorpay_order_id,
                    razorpay_payment_id
                });

                return reply.code(400).send({
                    success: false,
                    message: "Invalid signature"
                });
            }

            // 2. Update MASTER (SUCCESS)
            const master = await parentsubscriptionModel.findOneAndUpdate(
                { razorpay_order_id },
                {
                    payment_status: "SUCCESS",
                    razorpay_payment_id,
                    is_active: true,
                    start_date: today,
                    expire_date: expire
                },
                { new: true }
            );
            // 3. INSERT HISTORY
            await parentsubscriptionHistoryModel.create({
                student_id: studentId,
                location_id: master.location_id,
                subscription_type,
                amount: master.amount,
                payment_status: "SUCCESS",
                activated_at: today,
                expired_at: expire,
                razorpay_order_id,
                razorpay_payment_id
            });

            return reply.code(200).send({
                success: true,
                message: "Payment verified and subscription activated",
                subscription: master
            });

        } catch (error) {
            return reply.code(500).send({
                status: false,
                message: "Internal Server Error",
                error: error.message
            });
        }
    });


    fastify.put('/update', async (request, reply) => {
        try {
            const { studentId } = request.body
            await parentsubscriptionModel.updateOne({ student_id: studentId }, { is_active: false })
            return reply.code(200).send(true)
        } catch (error) {
            return reply
                .code(500)
                .send({ status: false, message: "Internal Server Error", error: error.message });
        }
    })

}