import express from "express";

import dotenv from "dotenv";
import fs from "fs";
import { MongoClient } from "mongodb";
import chunkArray from "./chunkArray";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { TaskType } from "@google/generative-ai";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
app.use(express.json());

// need to connect database here
const connectToDatabase = async () => {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();

    const database = client.db();
    const collection = database.collection("products");
    return collection;
  } catch (error) {
    console.error("Error connecting to database:", error);
    throw error;
  }
};

app.get("/", (req, res) => {
  res.json({ message: "Server is running =>>>>>>>>>>>>>>>>>>!" });
});

// need to create 10k product data and store in database dammy.
/**
 * productName
 * normalPrice
 * discountPrice
 * category
 * tags
 * */

const createProductIntoDB = async () => {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    const products = "./fake_products_100k.json";
    const data = fs.readFileSync(products, "utf-8");
    const productsData = JSON.parse(data);
    const res = await connectToDatabase();
    const chunk = await chunkArray(productsData, 1000);
    for (const chunk of chunks) {
      await collection.insertMany(chunk);
      console.log(`Inserted ${chunk.length} products`);
    }
    console.log("All products inserted successfully");
  } catch (error) {
    console.error("Error reading or parsing product data:", error);
    throw error;
  } finally {
    await client.close();
  }
};

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "gemini-embedding-001", // 768 dimensions
  taskType: TaskType.RETRIEVAL_DOCUMENT,
  title: "Document title",
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${process.env.IP_ADDRESS}:${PORT}`);
  createProductIntoDB().catch((error) => {
    console.error("Automatic product seeding failed:", error);
  });
});
