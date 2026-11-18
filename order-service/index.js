const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// 1. CONFIGURATION
const PORT = process.env.PORT || 3000;
const RESTAURANT_SERVICE_URL =
    process.env.RESTAURANT_SERVICE_URL || "http://localhost:3001";

// 2. IN-MEMORY STORAGE
const orders = [];
const idempotencyStore = new Map();

// 3. REQUEST ID MIDDLEWARE
app.use((req, res, next) => {
    const requestId = crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    console.log({ requestId, method: req.method, path: req.path });
    next();
});

// 4. AXIOS HTTP CLIENT (2s deadline)
const restaurantClient = axios.create({
    baseURL: RESTAURANT_SERVICE_URL,
    timeout: 2000,
    headers: { "Content-Type": "application/json" }
});

// 5. BOUNDED RETRY (max 3 attempts, only for network/5xx errors)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getRestaurantWithRetry(restaurantId, requestId) {
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            console.log({ requestId, message: `Restaurant request attempt: ${attempt + 1}` });

            const response = await restaurantClient.get(
                `/restaurants/${restaurantId}`,
                { headers: { "X-Request-ID": requestId } }
            );
            return response.data;
        } catch (error) {
            // Client errors such as 404 are not retried
            if (error.response && error.response.status < 500) {
                throw error;
            }
            if (attempt === maxRetries) {
                throw error;
            }
            const delay = 500 * (2 ** attempt);
            console.log({ requestId, message: `Retrying after ${delay}ms` });
            await sleep(delay);
        }
    }
}

// 6. HEALTH CHECK
app.get("/health", (req, res) => {
    res.status(200).json({
        service: "order-service",
        status: "healthy",
        requestId: req.requestId
    });
});

// 7. CREATE ORDER
app.post("/orders", async (req, res) => {
    const { restaurant_id, customer_name, items } = req.body || {};

    if (
        !Number.isInteger(restaurant_id) ||
        restaurant_id <= 0 ||
        typeof customer_name !== "string" ||
        !customer_name.trim() ||
        !Array.isArray(items) ||
        items.length === 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid order data",
            requestId: req.requestId
        });
    }

    const validItems = items.every(item =>
        item &&
        typeof item.name === "string" &&
        item.name.trim().length > 0 &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0
    );

    if (!validItems) {
        return res.status(400).json({
            success: false,
            message: "Invalid order items",
            requestId: req.requestId
        });
    }

    // Optional: if the client sends no key, generate one (no duplicate protection then)
    const idempotencyKey = req.get("Idempotency-Key") || crypto.randomUUID();

    const existing = idempotencyStore.get(idempotencyKey);

    if (existing) {
        if (existing.status === "processing") {
            return res.status(409).json({
                success: false,
                message: "This order is already processing",
                requestId: req.requestId
            });
        }
        return res.status(200).json({
            success: true,
            message: "Existing order returned",
            data: existing.order,
            requestId: req.requestId
        });
    }

    // Reserve the key before the remote call
    idempotencyStore.set(idempotencyKey, { status: "processing" });

    try {
        const restaurant = await getRestaurantWithRetry(restaurant_id, req.requestId);

        if (!restaurant.data.available) {
            idempotencyStore.delete(idempotencyKey);
            return res.status(409).json({
                success: false,
                message: "Restaurant is unavailable",
                requestId: req.requestId
            });
        }

        const order = {
            id: crypto.randomUUID(),
            restaurant_id,
            restaurant_name: restaurant.data.name,
            customer_name: customer_name.trim(),
            items,
            status: "created",
            created_at: new Date().toISOString()
        };

        orders.push(order);
        idempotencyStore.set(idempotencyKey, { status: "completed", order });

        return res.status(201).json({
            success: true,
            message: "Order created successfully",
            data: order,
            requestId: req.requestId
        });
    } catch (error) {
        idempotencyStore.delete(idempotencyKey);

        console.error({ requestId: req.requestId, error: error.message });

        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
            return res.status(504).json({
                success: false,
                message: "Restaurant Service timeout",
                requestId: req.requestId
            });
        }

        if (error.response) {
            if (error.response.status === 404) {
                return res.status(404).json({
                    success: false,
                    message: "Restaurant not found",
                    requestId: req.requestId
                });
            }
            return res.status(502).json({
                success: false,
                message: "Restaurant Service returned an error",
                requestId: req.requestId
            });
        }

        return res.status(503).json({
            success: false,
            message: "Restaurant Service unavailable",
            requestId: req.requestId
        });
    }
});

// 8. GET ALL ORDERS
app.get("/orders", (req, res) => {
    res.status(200).json({ success: true, data: orders });
});

// 9. GET SINGLE ORDER
app.get("/orders/:id", (req, res) => {
    const order = orders.find(o => o.id === req.params.id);

    if (!order) {
        return res.status(404).json({
            success: false,
            message: "Order not found",
            requestId: req.requestId
        });
    }
    res.status(200).json({ success: true, data: order });
});

// 10. START SERVER
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Order Service running on port ${PORT}`);
});
