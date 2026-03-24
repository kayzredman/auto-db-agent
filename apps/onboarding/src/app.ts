import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import { OnboardingService, OnboardRequest, UpdateRequest, CredentialUpdateRequest } from "@auto-dba-agent/shared";

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 4001;

app.use(cors());
app.use(express.json());

let metricsPool: pg.Pool;
let onboardingService: OnboardingService;

// Health endpoint
app.get("/health", async (_req, res) => {
  res.json({ status: "onboarding-service up", checkedAt: new Date().toISOString() });
});

// TODO: Add onboarding routes here using onboardingService

app.listen(PORT, () => {
  console.log(`Onboarding service running on port ${PORT}`);
});
