export default function getExpiryDate(subscription_type = "MONTHLY") {
    const now = new Date();

    if (subscription_type === "MONTHLY") {
        now.setMonth(now.getMonth() + 1);
    } else if (subscription_type === "QUARTERLY") {
        now.setMonth(now.getMonth() + 3);
    } else if (subscription_type === "YEARLY") {
        now.setFullYear(now.getFullYear() + 1);
    }

    return now;
}