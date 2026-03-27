import fs from "fs";
import path from "path";

// ✅ Stable Gemini Flash model
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

// ✅ Memory folder (Vercel-compatible)
const MEMORY_DIR = "/tmp/memory";
if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR);

// 🧠 Load user memory
function loadMemory(userId) {
  const filePath = path.join(MEMORY_DIR, `memory_${userId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (err) {
    console.error(`❌ Failed to load memory for ${userId}:`, err);
  }

  return {
    userId,
    lastProject: null,
    lastTask: null,
    conversation: [
      {
        role: "system",
        content: `
You are **MaxMovies AI** — an expressive, helpful, brilliant film-focused assistant 🤖🎬.

• You specialize in movies, TV series, recommendations, analysis, and entertainment.
• Speak like a chill, smart Nairobi techie 😎.
• Default English, switch to Swahili/Sheng if user does.
• Be natural, expressive, and helpful.
• Never say "I'm an AI".
        `,
      },
    ],
  };
}

// 💾 Save memory
function saveMemory(userId, memory) {
  const filePath = path.join(MEMORY_DIR, `memory_${userId}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), "utf-8");
  } catch (err) {
    console.error(`❌ Failed to save memory for ${userId}:`, err);
  }
}

// 🌍 Detect language
function detectLanguage(text) {
  const lower = text.toLowerCase();

  const swahiliWords = ["habari", "sasa", "niko", "kwani", "basi", "ndio"];
  const shengWords = ["bro", "maze", "noma", "fiti", "safi", "msee", "poa"];

  const sw = swahiliWords.filter((w) => lower.includes(w)).length;
  const sh = shengWords.filter((w) => lower.includes(w)).length;

  if (sw + sh === 0) return "english";
  if (sw + sh < 3) return "mixed";
  return "swahili";
}

// 🚀 API handler
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt, project, userId } = req.body;

    if (!prompt || !userId) {
      return res.status(400).json({ error: "Missing prompt or userId" });
    }

    // 🧠 Load memory
    let memory = loadMemory(userId);
    if (project) memory.lastProject = project;
    memory.lastTask = prompt;

    memory.conversation.push({
      role: "user",
      content: prompt,
    });

    // 🌍 Language handling
    const lang = detectLanguage(prompt);

    let languageInstruction = "";
    if (lang === "swahili") {
      languageInstruction = "Respond in Swahili or Sheng.";
    } else if (lang === "mixed") {
      languageInstruction =
        "Respond mostly in English with some Swahili/Sheng naturally.";
    } else {
      languageInstruction = "Respond in English.";
    }

    // 🧩 Build context
    const history = memory.conversation
      .slice(-10)
      .map((msg) =>
        `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`
      )
      .join("\n");

    const promptText = `
${history}

Instruction: ${languageInstruction}

User: ${prompt}
`;

    // 🔥 Gemini request (FIXED)
    const geminiResponse = await fetch(
      `${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: promptText }],
            },
          ],
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: 1000,
            topP: 0.95,
            topK: 40,
          },
        }),
      }
    );

    // 🛑 Handle API errors properly
    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("❌ Gemini API error:", errorText);

      return res.status(geminiResponse.status).json({
        error: "Gemini API error",
        details: errorText,
      });
    }

    const result = await geminiResponse.json();

    const reply =
      result?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "⚠️ No response";

    const cleanReply = reply.replace(/as an ai|language model/gi, "");

    // 💾 Save memory
    memory.conversation.push({
      role: "assistant",
      content: cleanReply,
    });

    if (memory.conversation.length > 50) {
      memory.conversation = memory.conversation.slice(-50);
    }

    saveMemory(userId, memory);

    return res.status(200).json({
      reply: cleanReply,
      model: "gemini-1.5-flash",
    });
  } catch (err) {
    console.error("💥 Server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
