const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// Request ID middleware: reuse the caller's ID so logs match across services
app.use((req, res, next) => {
    const requestId = req.get("X-Request-ID") || crypto.randomUUID();
    req.requestId = requestId;
    console.log({ requestId, method: req.method, path: req.path });
    res.setHeader("X-Request-ID", requestId);
    next();
});

const restaurants = [
    { id: 1, name: "Pizza Palace", cuisine: "Italian", available: true },
    { id: 2, name: "Burger House", cuisine: "Fast Food", available: true },
    { id: 3, name: "Food Corner", cuisine: "Bangladeshi", available: false }
];

app.get("/restaurants", (req, res) => {
    res.status(200).json({ success: true, data: restaurants });
});

app.get("/restaurants/:id", (req, res) => {
    const id = Number(req.params.id);
    const restaurant = restaurants.find(r => r.id === id);

    if (!restaurant) {
        return res.status(404).json({ success: false, message: "Restaurant not found" });
    }
    res.status(200).json({ success: true, data: restaurant });
});

app.get("/health", (req, res) => {
    res.status(200).json({ service: "restaurant-service", status: "healthy" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Restaurant Service running on port ${PORT}`);
});
