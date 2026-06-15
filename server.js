import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import Razorpay from "razorpay";
import crypto from "crypto";
import dotenv from "dotenv";
import session from "express-session";
import path from "path";
import Groq from "groq-sdk";
import { fileURLToPath } from "url";

dotenv.config();

// --- Helper for __dirname in ES Modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- EJS and Session Setup ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true })); // To parse form data
app.use(session({
  secret: process.env.SESSION_SECRET || "your-secret-key",
  resave: false,
  saveUninitialized: true,
}));

// --- Groq AI Setup ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PORTFOLIO_DATA = `
Name: Tiwari Ajay Virendra
Skills: React, Node, Express, MongoDB, MySQL, Tailwind, Docker, Kubernetes, Firebase, Python, 
Data Science: NumPy, Pandas, PyTorch, TensorFlow, PySpark, OpenCV.
AI/ML Algorithms: Linear & Logistic Regression, Classification, General Logistics, ETL Pipeline architecture.
Projects: Jigoogle Numbers, Live Chat, Panel Paradise, Pest Mark, ETL Pipeline Creation (End-to-End Data Processing).
`;

const SYSTEM_PROMPT = `
You are "Jigoogle-AI", a helpful assistant for Ajay's portfolio.
Use this data: ${PORTFOLIO_DATA}.
If you don't know the user's name, ask "Aapka shubh naam kya hai?".
Respond in Hinglish or the user's language.
Keep answers professional but friendly.
`;

app.use(cors());
app.use(express.json()); // Required to parse JSON bodies

const razorpay = new Razorpay({
  key_id: process.env.VITE_RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// --- In-memory data storage (for demonstration) ---
let messages = [];
let donations = [];
let messageIdCounter = 1;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("send_message", async (data) => {
    console.log("📩 Message received:", data);

    try {
      // 1. Get AI Response from Groq
      const chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: data.text }
        ],
        model: "llama-3.3-70b-versatile",
      });

      const aiResponse = chatCompletion.choices[0]?.message?.content || "Sorry, main samajh nahi pa raha hoon.";

      // 2. Prepare AI Message object
      const aiMessage = {
        id: messageIdCounter++,
        user: "Jigoogle-AI",
        text: aiResponse,
        timestamp: new Date(),
        isAI: true,
      };

      messages.push(aiMessage);
      io.emit("receive_message", aiMessage);
    } catch (error) {
      console.error("❌ Groq AI Error:", error);
    }
  });

  socket.on("delete_for_everyone", (ids) => {
    messages = messages.filter((msg) => !ids.includes(msg.id));
    io.emit("delete_for_everyone", ids);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Razorpay Routes
app.post("/api/orders", async (req, res) => {
  try {
    const options = {
      amount: req.body.amount * 100, // Amount in paise
      currency: "INR",
      receipt: "receipt_" + Date.now(),
    };
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).send(error);
  }
});

app.post("/api/verify", async (req, res) => {
  try {
    // Assuming 'amount' is sent from the client upon successful payment
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature === expectedSign) {
      // Store donation details
      const newDonation = {
        id: razorpay_payment_id,
        amount: amount / 100, // Convert from paise to rupees
        paymentId: razorpay_payment_id,
        date: new Date(),
        status: "Success",
      };
      donations.push(newDonation);

      res.json({ success: true, message: "Payment verified" });
    } else {
      res.status(400).json({ success: false, message: "Invalid signature" });
    }
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).send(error);
  }
});

// --- Admin Panel Routes ---

// Middleware to protect admin routes
function ensureAuthenticated(req, res, next) {
  if (req.session.isAuthenticated) {
    return next();
  }
  res.redirect("/admin/login");
}

app.get("/admin", (req, res) => {
  res.redirect("/admin/dashboard");
});

app.get("/admin/login", (req, res) => {
  res.render("admin-login", { error: null });
});

app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAuthenticated = true;
    res.redirect("/admin/dashboard");
  } else {
    res.render("admin-login", { error: "❌ Incorrect Password!" });
  }
});

app.get("/admin/dashboard", ensureAuthenticated, (req, res) => {
  const sortedMessages = [...messages].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const sortedDonations = [...donations].sort((a, b) => new Date(b.date) - new Date(a.date));
  res.render("admin-dashboard", {
    messages: sortedMessages,
    donations: sortedDonations,
  });
});

app.post("/admin/messages/delete/:id", ensureAuthenticated, (req, res) => {
  const messageId = parseInt(req.params.id, 10);
  messages = messages.filter((msg) => msg.id !== messageId);
  res.redirect("/admin/dashboard");
});

app.post("/admin/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) console.log(err);
    res.redirect("/admin/login");
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
