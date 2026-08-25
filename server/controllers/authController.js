import { User } from "../models/User.js";
import jwt from "jsonwebtoken";

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error("JWT_SECRET must be configured and contain at least 32 characters");
    }
    return secret;
}

const setSessionCookie = (res, payload) => {
    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: "30d" });

    res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: "/",
    });
};

export async function register(req, res) {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: "Name, email and password are required." });
    }

    const trimmedName = String(name).trim();
    const trimmedEmail = String(email).toLowerCase().trim();

    if (!trimmedName || !trimmedEmail || String(password).length < 8) {
        return res.status(400).json({
            error: "Provide a valid name, email and a password of at least 8 characters.",
        });
    }

    const existing = await User.findOne({ email: trimmedEmail });
    if (existing) {
        return res.status(409).json({ error: "An account with this email already exists." });
    }

    const user = await User.create({
        name: trimmedName,
        email: trimmedEmail,
        password,
    });

    setSessionCookie(res, { userId: user._id.toString(), email: user.email });

    return res.status(201).json({
        user: {
            _id: user._id,
            name: user.name,
            email: user.email,
        },
    });
}

export async function login(req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await User.findOne({
        email: String(email).toLowerCase().trim(),
    });

    if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ error: "Invalid email or password" });
    }

    setSessionCookie(res, { userId: user._id.toString(), email: user.email });

    return res.status(200).json({
        user: {
            _id: user._id,
            name: user.name,
            email: user.email,
        },
    });
}

export async function logout(_req, res) {
    res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
    });

    res.json({ success: true });
}

export async function me(req, res) {
    if (!req.user) {
        return res.status(401).json({ error: "Not authenticated." });
    }

    const user = await User.findById(req.user.userId).select("-password");
    if (!user) {
        return res.status(404).json({ error: "User not found." });
    }

    return res.json({ user });
}
