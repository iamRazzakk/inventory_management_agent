import express from "express";

import dotenv from "dotenv";
import fs from "fs";
import { MongoClient } from "mongodb";
import chunkArray from "./chunkArray.js";
import {
  ChatGoogleGenerativeAI,
  GoogleGenerativeAIEmbeddings,
} from "@langchain/google-genai";
import { TaskType } from "@google/generative-ai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
app.use(express.json());

// need to connect database here
const connectToDatabase = async () => {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db();
    const collection = db.collection("products");
    return { client, collection };
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
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

//  gemini api model
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  temperature: 0.7,
  maxOutputTokens: 200,
  maxRetries: 2,
});

//TODO: vector embeddings and vector db
const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "gemini-embedding-001", // 768 dimensions
  taskType: TaskType.RETRIEVAL_DOCUMENT,
  title: "Document title",
});

const collectionName = process.env.QDRANT_COLLECTION_NAME || "store_agent";
const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
  url: process.env.QDRANT_URL,
  collectionName,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatProductDetails = (product) => {
  const tags = Array.isArray(product?.tags) ? product.tags.join(", ") : "";

  return [
    `Product name: ${product?.productName ?? "Unknown"}`,
    `Normal price: $${product?.normalPrice ?? "N/A"}`,
    `Discount price: $${product?.discountPrice ?? "N/A"}`,
    `Category: ${product?.category ?? "N/A"}`,
    `Tags: ${tags || "N/A"}`,
  ].join("\n");
};

const createProductIntoDB = async () => {
  const productsPath = "./fake_products.json";
  const data = fs.readFileSync(productsPath, "utf-8");
  const productsData = JSON.parse(data);
  const batchSize = 50;

  const { client, collection } = await connectToDatabase();

  try {
    const chunks = await chunkArray(productsData, batchSize);

    // helper to sleep
    // const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // const windowStart = Date.now();

      // insert raw product docs into MongoDB
      await collection.insertMany(chunk);

      // convert to documents for the vector DB
      const docs = chunk.map((p) => ({
        pageContent:
          p.description ??
          `${p.productName} — ${p.category}. Price: $${p.normalPrice}, discount: $${p.discountPrice}. Tags: ${
            p.tags?.join?.(", ") ?? ""
          }`,
        metadata: {
          productName: p.productName,
          normalPrice: p.normalPrice,
          discountPrice: p.discountPrice,
          category: p.category,
          tags: p.tags,
        },
      }));

      // chunk directly to qdrant with embedding
      try {
        const res = await vectorStore.addDocuments(docs);
        // console.log("resp:::",res)
      } catch (embErr) {
        console.log(`Embedding failed :`, embErr);
      }
      // const elapsed = Date.now() - windowStart;
      // const waitFor = 1000 - elapsed;
      // if (waitFor > 0) await sleep(waitFor);
    }
    console.log("All products inserted successfully");
  } catch (error) {
    console.error("Error inserting products:", error);
    throw error;
  } finally {
    if (client) await client.close();
  }
};

app.post("/search/ai", async (req, res) => {
  const input = req.body?.input;
  // console.log("Received search query:", input);

  if (!input) {
    return res.status(400).json({ error: "Missing 'input' in request body" });
  }

  const searchText = String(input).trim();

  const docs = await vectorStore.similaritySearch(searchText, 10);
  // console.log("docs::::", docs);
  if (!docs.length) {
    return res.json({ ai: "Sorry, I don't have that information." });
  }

  const context = docs
    .slice(0, 3)
    .map((d) => d.pageContent)
    .join("\n\n---\n\n");
  try {
    const response = await llm.invoke([
      new SystemMessage(`
You are a JARVIS AI assistant for an e-commerce store.

RULES:
- Use ONLY given context
- If user asks for list, return multiple products
- Format as bullet list:
  - Product name
  - Price
  - Category
- If not enough info say "I don't know"

Context:
${context}
`),
      new HumanMessage(searchText),
    ]);
    return res.json({ ai: response.content });
  } catch (error) {
    // console.error("Error generating AI response:", error);
    const status = error?.status ?? error?.response?.status;
    if (status === 503) {
      return res.json({
        ai: "The AI model is busy right now. Please try again in a moment.",
      });
    }
    return res.json({
      ai: "Sorry, I encountered an error while processing your request.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${process.env.IP_ADDRESS}:${PORT}`);
  // createProductIntoDB().catch((error) => {
  //   console.error("Automatic product seeding failed:", error);
  // });
});
