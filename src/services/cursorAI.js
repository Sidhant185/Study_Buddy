/**
 * AI API Service
 * Handles code review, evaluation, and practice question generation
 * 
 * Uses Google Gemini API for AI-powered code analysis
 */

// In Vite, only variables prefixed with VITE_ are exposed to client code
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("⚠️ GEMINI_API_KEY not found in environment variables");
  console.warn("Available env vars:", Object.keys(import.meta.env).filter(k => k.toUpperCase().includes("GEMINI") || k.toUpperCase().includes("API")));
}

/**
 * List available Gemini models (for debugging)
 */
async function listGeminiModels(apiKey) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      return data.models?.map(m => m.name) || [];
    }
  } catch (error) {
    console.warn("Could not list Gemini models:", error);
  }
  return [];
}

/**
 * Call Gemini API with timeout and comprehensive error handling
 */
async function callGeminiAPI(systemPrompt, userPrompt, options = {}) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || GEMINI_API_KEY;
  const timeout = options.timeout || 60000; // Default 60 second timeout
  
  if (!apiKey || apiKey === "undefined" || apiKey === "null" || apiKey.trim() === "") {
    console.error("🔑 GEMINI_API_KEY validation failed");
    throw new Error("GEMINI_API_KEY is not configured");
  }
  
  if (!systemPrompt || !userPrompt) {
    console.error("📝 API prompts validation failed:", { systemPrompt: !!systemPrompt, userPrompt: !!userPrompt });
    throw new Error("Both systemPrompt and userPrompt are required");
  }
  
  console.log(`🚀 callGeminiAPI: Starting with timeout ${timeout}ms, temp ${options.temperature || 0.7}, tokens ${options.max_tokens || 6000}`);

  try {
    // First, list available models to use the correct ones
    let availableModels = null;
    let modelsToTry = [];
    
    try {
      availableModels = await listGeminiModels(apiKey);
      if (availableModels.length > 0) {
        console.log(`📋 Found ${availableModels.length} available Gemini models`);
        
        // Extract model names without "models/" prefix
        const availableModelNames = availableModels.map(am => am.replace("models/", ""));
        
        // Priority order: prefer fast flash models first for speed
        const preferredModels = [
          "gemini-2.5-flash",      // Fastest stable flash
          "gemini-2.0-flash",      // Alternative fast flash
          "gemini-flash-latest",   // Always latest flash (fastest)
          "gemini-2.5-pro",        // Pro models (slower but more capable)
          "gemini-pro-latest",     // Always latest pro
        ];
        
        // Find available models from preferred list (exact match)
        for (const preferred of preferredModels) {
          if (availableModelNames.includes(preferred)) {
            modelsToTry.push(preferred);
          }
        }
        
        // If no preferred models found, use first available non-embedding model
        if (modelsToTry.length === 0) {
          const nonEmbedding = availableModelNames.filter(mn => 
            !mn.includes("embedding") && 
            !mn.includes("imagen") && 
            !mn.includes("aqa") &&
            !mn.includes("robotics") &&
            (mn.includes("flash") || mn.includes("pro"))
          );
          if (nonEmbedding.length > 0) {
            modelsToTry.push(nonEmbedding[0]);
            console.log(`⚠️ Using first available model: ${nonEmbedding[0]}`);
          }
        }
        
        if (modelsToTry.length > 0) {
          console.log(`✅ Will try models in order: ${modelsToTry.join(", ")}`);
        } else {
          throw new Error("No suitable Gemini models found in available models");
        }
      } else {
        throw new Error("Could not fetch available models");
      }
    } catch (e) {
      console.warn("Could not list available models, using fallback list:", e.message);
      // Fallback to known good models based on the error message
      modelsToTry = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];
    }
    
    let lastError = null;
    
    for (const model of modelsToTry) {
      try {
        console.log(`🔄 Trying Gemini model: ${model}`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        // Combine system and user prompts for Gemini
        const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
        
        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.warn(`⏰ callGeminiAPI: Request timeout after ${timeout}ms for model ${model}`);
          controller.abort();
        }, timeout);

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: fullPrompt
              }]
            }],
            generationConfig: {
              temperature: options.temperature ?? 0.5, // Lower temperature for faster, more focused responses
              // Fixed token limit: 6000 tokens for all calls
              maxOutputTokens: options.max_tokens ?? 6000,
            },
          }),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch (e) {
            errorData = { error: { message: errorText } };
          }
          
          console.error(`❌ Gemini API error for model ${model}:`, {
            status: response.status,
            statusText: response.statusText,
            error: errorData.error,
            fullResponse: errorText.substring(0, 500)
          });
          
          // If model not found, try next model
          if (response.status === 404 && (errorData.error?.message?.includes("not found") || errorData.error?.message?.includes("not supported"))) {
            console.warn(`⚠️ Model ${model} not available (404). Error: ${errorData.error?.message || errorText.substring(0, 200)}`);
            lastError = new Error(`Model ${model} not available: ${errorData.error?.message || errorText.substring(0, 200)}`);
            continue;
          }
          
          // For other errors, provide detailed info
          const errorMsg = `Gemini API error (${model}): HTTP ${response.status} ${response.statusText}\n` +
            `Error: ${errorData.error?.message || errorText.substring(0, 300)}\n` +
            (availableModels ? `Available models: ${availableModels.join(", ")}` : "Could not fetch available models");
          throw new Error(errorMsg);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const finishReason = candidate?.finishReason;
        
        // Try to extract content from different possible locations
        let content = candidate?.content?.parts?.[0]?.text;
        if (!content && candidate?.content?.parts) {
          // Try to find text in any part
          const textPart = candidate.content.parts.find(p => p.text);
          content = textPart?.text;
        }
        
        // Handle MAX_TOKENS - response was cut off
        if (finishReason === "MAX_TOKENS") {
          if (content && content.trim().length > 0) {
            // We have partial content - return it with a warning
            console.warn(`⚠️ Gemini API hit token limit (MAX_TOKENS). Response was truncated but partial content received (${content.length} chars).`);
            console.warn(`   Used ${data.usageMetadata?.totalTokenCount || "unknown"} tokens (prompt: ${data.usageMetadata?.promptTokenCount || "unknown"}, output: ${data.usageMetadata?.candidatesTokenCount || "unknown"}).`);
            // Try to parse what we have - if it's JSON, try to complete it
            if (content.trim().startsWith("{")) {
              try {
                // Try to parse as JSON - if it fails, the JSON might be incomplete
                JSON.parse(content);
                // If parsing succeeds, return it
                return content;
              } catch (e) {
                // JSON is incomplete - try to fix it or return with note
                console.warn("   JSON response was truncated. Attempting to extract valid JSON...");
                // Try to find the last complete JSON object
                const lastBrace = content.lastIndexOf("}");
                if (lastBrace > 0) {
                  try {
                    const partialJson = content.substring(0, lastBrace + 1);
                    JSON.parse(partialJson);
                    return partialJson;
                  } catch (e2) {
                    // Still invalid, return with note
                  }
                }
                return content + "\n\n[Note: Response was truncated due to token limit. Some content may be missing.]";
              }
            }
            return content;
          } else {
            // MAX_TOKENS with no content - throw error (no retry)
            const currentLimit = options.max_tokens ?? 6000;
            const usedTokens = data.usageMetadata?.totalTokenCount || 0;
            const promptTokens = data.usageMetadata?.promptTokenCount || 0;
            throw new Error(`Gemini API hit token limit (${currentLimit}) with no content returned. Used ${usedTokens} tokens (prompt: ${promptTokens}). The response may require more tokens than the limit allows.`);
          }
        }
        
        if (!content) {
          // Check if there's a safety rating issue
          if (finishReason === "SAFETY") {
            const safetyRatings = candidate?.safetyRatings || [];
            throw new Error(`Gemini API blocked content due to safety filters. Ratings: ${JSON.stringify(safetyRatings)}`);
          }
          
          throw new Error(`Gemini API returned no content. Finish reason: ${finishReason || "unknown"}. Response: ${JSON.stringify(data).substring(0, 500)}`);
        }
        
        console.log(`✅ Gemini API success using model: ${model}`);
        return typeof content === "string" ? content : String(content);
      } catch (error) {
        console.error(`❌ callGeminiAPI: Error for model ${model}:`, error.message);
        
        // Handle specific error types
        if (error.name === 'AbortError') {
          console.error(`⏰ callGeminiAPI: Request timed out after ${timeout}ms for model ${model}`);
          lastError = new Error(`API request timed out after ${timeout}ms for model ${model}`);
        } else if (error.message.includes("not found") || error.message.includes("404") || error.message.includes("not available")) {
          lastError = error;
          console.warn(`⚠️ callGeminiAPI: Model ${model} not available, trying next...`);
        } else if (error.message.includes("Failed to fetch") || error.name === 'TypeError') {
          console.error(`🌐 callGeminiAPI: Network error for model ${model}:`, error.message);
          lastError = new Error(`Network error: ${error.message}`);
        } else {
          // Other errors, throw immediately
          console.error(`💥 callGeminiAPI: Unexpected error for model ${model}:`, error);
          throw error;
        }
        
        continue;
      }
    }
    
    // If all models failed, provide comprehensive error
    const errorMsg = `All Gemini models failed. Tried: ${modelsToTry.join(", ")}\n` +
      (lastError ? `Last error: ${lastError.message}` : "Unknown error") +
      (availableModels ? `\nAvailable models: ${availableModels.join(", ")}` : "\nCould not determine available models. Check your API key and enable the Gemini API in Google Cloud Console.");
    throw new Error(errorMsg);
  } catch (error) {
    console.error("Gemini API error:", error);
    throw error;
  }
}


/**
 * Evaluate student code submission
 * @param {Object} params - Evaluation parameters
 * @param {string} params.studentCode - Student's submitted code
 * @param {string} params.expectedSolution - Reference solution code
 * @param {string} params.questionDescription - Problem description
 * @param {Array} params.testCases - Test cases with inputs/outputs
 * @param {Object} params.studentHistory - Previous evaluations/topics (optional)
 * @returns {Promise<Object>} Evaluation report
 */
export async function evaluateCodeSubmission({
  studentCode,
  expectedSolution,
  questionDescription,
  testCases = [],
  studentHistory = null,
}) {
  const systemPrompt = `You are an expert Java programming instructor evaluating student code submissions. 
Your task is to provide constructive feedback, identify strengths and weaknesses, and suggest improvements.
Be specific, educational, and encouraging. Focus on code quality, best practices, and learning opportunities.`;

  const historyContext = studentHistory
    ? `\n\nStudent's previous weak topics: ${JSON.stringify(studentHistory.weakTopics || [])}
Student's previous strong topics: ${JSON.stringify(studentHistory.strongTopics || [])}
Previous contest performance trends: ${JSON.stringify(studentHistory.trends || {})}`
    : "";

  const userPrompt = `Evaluate the following Java code submission:

**Problem Description:**
${questionDescription}

**Expected Solution (Reference):**
\`\`\`java
${expectedSolution}
\`\`\`

**Student's Submission:**
\`\`\`java
${studentCode}
\`\`\`

**Test Cases:**
${Array.isArray(testCases) && testCases.length > 0
  ? testCases.map((tc, i) => {
      const input = tc?.input || tc?.inputValue || "";
      const output = tc?.expectedOutput || tc?.output || "";
      return `Test ${i + 1}: Input="${input}", Expected="${output}"`;
    }).join("\n")
  : "No test cases provided"}
${historyContext}

Please provide a comprehensive evaluation in the following JSON format:
{
  "strengths": ["strength1", "strength2", ...],
  "weaknesses": ["weakness1", "weakness2", ...],
  "suggestions": ["suggestion1", "suggestion2", ...],
  "topicScores": {
    "topicName": score (0-100),
    ...
  },
  "overallScore": 0-100,
  "detailedAnalysis": "Detailed written analysis of the code...",
  "practiceQuestions": [
    {
      "title": "Question title",
      "description": "Problem description",
      "codeTemplate": "// Your code here",
      "testCases": [{"input": "...", "expectedOutput": "..."}],
      "topics": ["topic1", "topic2"],
      "difficulty": "easy|medium|hard"
    },
    ...
  ]
}

Topics to evaluate (rate 0-100): algorithms, data structures, object-oriented programming, error handling, code style, efficiency, problem-solving approach.

Generate 5-10 practice questions focusing on identified weak areas from this contest. Ensure topics don't repeat unnecessarily. These are for current contest practice.`;

  try {
    const response = await callGeminiAPI(systemPrompt, userPrompt, {
      temperature: 0.5, // Lower for faster responses
      max_tokens: 6000, // Fixed token limit
    });

    // Ensure response is a string
    if (!response || typeof response !== "string") {
      throw new Error("AI API returned invalid response");
    }

    // Try to extract JSON from response
    let evaluationData;
    try {
      // Look for JSON block in markdown code fence
      const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        evaluationData = JSON.parse(jsonMatch[1]);
      } else {
        // Try parsing the entire response as JSON
        evaluationData = JSON.parse(response);
      }
    } catch (parseError) {
      // If JSON parsing fails, create a structured response from text
      console.warn("Failed to parse AI response as JSON, creating fallback structure");
      evaluationData = {
        strengths: [],
        weaknesses: [],
        suggestions: [],
        topicScores: {},
        overallScore: 50,
        detailedAnalysis: response || "No detailed analysis available",
        practiceQuestions: [],
      };
    }

    // Validate and normalize the response
    return {
      strengths: Array.isArray(evaluationData.strengths) ? evaluationData.strengths : [],
      weaknesses: Array.isArray(evaluationData.weaknesses) ? evaluationData.weaknesses : [],
      suggestions: Array.isArray(evaluationData.suggestions) ? evaluationData.suggestions : [],
      topicScores: typeof evaluationData.topicScores === "object" ? evaluationData.topicScores : {},
      overallScore: Number(evaluationData.overallScore) || 50,
      detailedAnalysis: evaluationData.detailedAnalysis || response,
      practiceQuestions: Array.isArray(evaluationData.practiceQuestions)
        ? evaluationData.practiceQuestions
        : [],
    };
  } catch (error) {
    console.error("Code evaluation error:", error);
    throw error;
  }
}

/**
 * Generate historical practice questions based on student's overall performance
 * @param {Object} params - Generation parameters
 * @param {Object} params.studentAnalytics - Aggregated topic analytics
 * @param {Array} params.pastEvaluations - Previous contest evaluations
 * @param {number} params.count - Number of questions to generate
 * @returns {Promise<Array>} Array of practice questions
 */
/**
 * Generate Maths Quiz using Gemini API
 * @param {Object} params - Quiz parameters
 * @param {string} params.topic - Maths topic (e.g., "Algebra", "Calculus")
 * @param {string} params.difficulty - "easy", "medium", or "hard"
 * @param {number} params.numQuestions - Number of questions (5-20)
 * @returns {Promise<Array>} Array of quiz questions
 */
export async function generateMathsQuiz({ topic, difficulty, numQuestions }) {
  const systemPrompt = `You are an expert mathematics instructor creating educational quizzes. 
Return ONLY valid JSON, no markdown, no explanations.`;

  const difficultyGuidelines = {
    easy: "Focus on basic definitions, simple calculations, and fundamental concepts. Use straightforward language.",
    medium: "Focus on application of concepts, multi-step problems, and moderate complexity. Test understanding.",
    hard: "Focus on advanced problem-solving, edge cases, optimization, and complex scenarios. Challenge critical thinking."
  };

  const userPrompt = `Generate a ${difficulty} level mathematics quiz on the topic: "${topic}".

Generate exactly ${numQuestions} multiple-choice questions.

For each question, follow this logic:
1. Select a specific fact/concept from the topic
2. Formulate a clear question stem
3. Identify the correct answer
4. Generate 3 plausible distractors (common mistakes, related concepts, or misconceptions)
5. Provide a brief explanation

Return ONLY this JSON format (no markdown):
{
  "questions": [
    {
      "id": 1,
      "question": "What is the derivative of x^2?",
      "options": {
        "A": "x",
        "B": "2x",
        "C": "x^2",
        "D": "2x^2"
      },
      "correctAnswer": "B",
      "explanation": "The derivative of x^2 is 2x using the power rule."
    }
  ]
}

Rules:
- Each question must have exactly 4 options (A, B, C, D)
- Correct answer must be one of A, B, C, or D
- Distractors must be plausible but incorrect
- Questions should progress from basic to more complex
- All questions must be related to: ${topic}
- Difficulty level: ${difficultyGuidelines[difficulty]}`;

  try {
    const response = await callGeminiAPI(systemPrompt, userPrompt, {
      temperature: 0.7, // Slightly higher for variety
      max_tokens: 8000, // Max tokens for quiz
    });

    // Parse JSON response
    let quizData;
    try {
      console.log("🤖 Quiz Raw Response (first 500 chars):", response.substring(0, 500));
      
      // Clean the response - remove any leading/trailing whitespace
      let cleanedResponse = response.trim();
      
      // Function to find balanced JSON object by tracking braces
      const findBalancedJSON = (str) => {
        let start = str.indexOf('{');
        if (start === -1) return null;
        
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = start; i < str.length; i++) {
          const char = str[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') {
              depth++;
            } else if (char === '}') {
              depth--;
              if (depth === 0) {
                return str.substring(start, i + 1);
              }
            }
          }
        }
        
        return null;
      };
      
      // Try to extract JSON from markdown code fence first
      const jsonMatch = cleanedResponse.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        console.log("✅ Found JSON in code fence");
        quizData = JSON.parse(jsonMatch[1]);
      } else {
        // Try to find balanced JSON object
        const jsonStr = findBalancedJSON(cleanedResponse);
        if (jsonStr) {
          console.log("✅ Found balanced JSON object");
          quizData = JSON.parse(jsonStr);
        } else {
          // Last resort: try parsing the entire response
          console.log("⚠️ Trying to parse entire response as JSON");
          quizData = JSON.parse(cleanedResponse);
        }
      }
      
      console.log("✅ Successfully parsed quiz:", {
        questionCount: quizData.questions?.length
      });
    } catch (parseError) {
      console.error("❌ JSON Parse Error:", parseError.message);
      const positionMatch = parseError.message.match(/position (\d+)/);
      if (positionMatch) {
        const pos = parseInt(positionMatch[1]);
        console.error("❌ Parse Error at position:", pos);
        console.error("❌ Context around error:", response.substring(Math.max(0, pos - 50), pos + 50));
      }
      console.error("❌ Failed Response (first 1000 chars):", response.substring(0, 1000));
      throw new Error(`Failed to parse quiz response: ${parseError.message}. Please try again.`);
    }

    // Validate and return
    if (!quizData.questions || !Array.isArray(quizData.questions)) {
      throw new Error("Invalid quiz format received from API");
    }

    if (quizData.questions.length !== numQuestions) {
      console.warn(`⚠️ Expected ${numQuestions} questions, got ${quizData.questions.length}`);
    }

    return quizData.questions;
  } catch (error) {
    console.error("Maths quiz generation error:", error);
    throw error;
  }
}

/**
 * Generate Web Development Quiz using Gemini API
 * @param {Object} params - Quiz parameters
 * @param {string} params.topic - Web development topic (e.g., "HTML", "CSS", "JavaScript", "React")
 * @param {string} params.difficulty - "easy", "medium", or "hard"
 * @param {number} params.numQuestions - Number of questions (5-10)
 * @returns {Promise<Array>} Array of quiz questions
 */
export async function generateWebQuiz({ topic, difficulty, numQuestions }) {
  const systemPrompt = `You are an expert web development instructor creating educational quizzes. 
Return ONLY valid JSON, no markdown, no explanations.`;

  const difficultyGuidelines = {
    easy: "Focus on basic definitions, simple syntax, and fundamental concepts. Use straightforward language.",
    medium: "Focus on application of concepts, code examples, and moderate complexity. Test understanding.",
    hard: "Focus on advanced problem-solving, edge cases, optimization, and complex scenarios. Challenge critical thinking."
  };

  const userPrompt = `Generate a ${difficulty} level web development quiz on the topic: "${topic}".

Generate exactly ${numQuestions} multiple-choice questions.

For each question, follow this logic:
1. Select a specific fact/concept from the topic
2. Formulate a clear question stem
3. Identify the correct answer
4. Generate 3 plausible distractors (common mistakes, related concepts, or misconceptions)
5. Provide a brief explanation

Return ONLY this JSON format (no markdown):
{
  "questions": [
    {
      "id": 1,
      "question": "What does HTML stand for?",
      "options": {
        "A": "HyperText Markup Language",
        "B": "High-level Text Markup Language",
        "C": "Hyperlink and Text Markup Language",
        "D": "Home Tool Markup Language"
      },
      "correctAnswer": "A",
      "explanation": "HTML stands for HyperText Markup Language, which is the standard markup language for creating web pages."
    }
  ]
}

Rules:
- Each question must have exactly 4 options (A, B, C, D)
- Correct answer must be one of A, B, C, or D
- Distractors must be plausible but incorrect
- Questions should progress from basic to more complex
- All questions must be related to: ${topic}
- Difficulty level: ${difficultyGuidelines[difficulty]}`;

  try {
    const response = await callGeminiAPI(systemPrompt, userPrompt, {
      temperature: 0.7, // Slightly higher for variety
      max_tokens: 8000, // Max tokens for quiz
    });

    // Parse JSON response (same logic as generateMathsQuiz)
    let quizData;
    try {
      console.log("🤖 Web Quiz Raw Response (first 500 chars):", response.substring(0, 500));
      
      let cleanedResponse = response.trim();
      
      const findBalancedJSON = (str) => {
        let start = str.indexOf('{');
        if (start === -1) return null;
        
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = start; i < str.length; i++) {
          const char = str[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') {
              depth++;
            } else if (char === '}') {
              depth--;
              if (depth === 0) {
                return str.substring(start, i + 1);
              }
            }
          }
        }
        
        return null;
      };
      
      const jsonMatch = cleanedResponse.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        console.log("✅ Found JSON in code fence");
        quizData = JSON.parse(jsonMatch[1]);
      } else {
        const jsonStr = findBalancedJSON(cleanedResponse);
        if (jsonStr) {
          console.log("✅ Found balanced JSON object");
          quizData = JSON.parse(jsonStr);
        } else {
          console.log("⚠️ Trying to parse entire response as JSON");
          quizData = JSON.parse(cleanedResponse);
        }
      }
      
      console.log("✅ Successfully parsed web quiz:", {
        questionCount: quizData.questions?.length
      });
    } catch (parseError) {
      console.error("❌ JSON Parse Error:", parseError.message);
      const positionMatch = parseError.message.match(/position (\d+)/);
      if (positionMatch) {
        const pos = parseInt(positionMatch[1]);
        console.error("❌ Parse Error at position:", pos);
        console.error("❌ Context around error:", response.substring(Math.max(0, pos - 50), pos + 50));
      }
      console.error("❌ Failed Response (first 1000 chars):", response.substring(0, 1000));
      throw new Error(`Failed to parse quiz response: ${parseError.message}. Please try again.`);
    }

    if (!quizData.questions || !Array.isArray(quizData.questions)) {
      throw new Error("Invalid quiz format received from API");
    }

    if (quizData.questions.length !== numQuestions) {
      console.warn(`⚠️ Expected ${numQuestions} questions, got ${quizData.questions.length}`);
    }

    return quizData.questions;
  } catch (error) {
    console.error("Web quiz generation error:", error);
    throw error;
  }
}

/**
 * Generate Java Programming Quiz using Gemini API
 * @param {Object} params - Quiz parameters
 * @param {string} params.topic - Java topic (e.g., "OOP", "Collections", "Multithreading", "Streams")
 * @param {string} params.difficulty - "easy", "medium", or "hard"
 * @param {number} params.numQuestions - Number of questions (5-10)
 * @returns {Promise<Array>} Array of quiz questions
 */
export async function generateJavaQuiz({ topic, difficulty, numQuestions }) {
  const systemPrompt = `You are an expert Java programming instructor creating educational quizzes. 
Return ONLY valid JSON, no markdown, no explanations.`;

  const difficultyGuidelines = {
    easy: "Focus on basic syntax, fundamental concepts, and simple code examples. Use straightforward language.",
    medium: "Focus on application of concepts, code analysis, and moderate complexity. Test understanding of Java features.",
    hard: "Focus on advanced concepts, design patterns, optimization, and complex scenarios. Challenge critical thinking."
  };

  const userPrompt = `Generate a ${difficulty} level Java programming quiz on the topic: "${topic}".

Generate exactly ${numQuestions} multiple-choice questions.

For each question, follow this logic:
1. Select a specific fact/concept from the topic
2. Formulate a clear question stem (can include code snippets)
3. Identify the correct answer
4. Generate 3 plausible distractors (common mistakes, related concepts, or misconceptions)
5. Provide a brief explanation

Return ONLY this JSON format (no markdown):
{
  "questions": [
    {
      "id": 1,
      "question": "What is the default access modifier for class members in Java?",
      "options": {
        "A": "public",
        "B": "private",
        "C": "protected",
        "D": "package-private (default)"
      },
      "correctAnswer": "D",
      "explanation": "In Java, if no access modifier is specified, the member has package-private (default) access, meaning it's accessible only within the same package."
    }
  ]
}

Rules:
- Each question must have exactly 4 options (A, B, C, D)
- Correct answer must be one of A, B, C, or D
- Distractors must be plausible but incorrect
- Questions should progress from basic to more complex
- All questions must be related to: ${topic}
- Difficulty level: ${difficultyGuidelines[difficulty]}`;

  try {
    const response = await callGeminiAPI(systemPrompt, userPrompt, {
      temperature: 0.7,
      max_tokens: 8000,
    });

    // Parse JSON response (same logic as other quiz functions)
    let quizData;
    try {
      console.log("🤖 Java Quiz Raw Response (first 500 chars):", response.substring(0, 500));
      
      let cleanedResponse = response.trim();
      
      const findBalancedJSON = (str) => {
        let start = str.indexOf('{');
        if (start === -1) return null;
        
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = start; i < str.length; i++) {
          const char = str[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') {
              depth++;
            } else if (char === '}') {
              depth--;
              if (depth === 0) {
                return str.substring(start, i + 1);
              }
            }
          }
        }
        
        return null;
      };
      
      const jsonMatch = cleanedResponse.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        console.log("✅ Found JSON in code fence");
        quizData = JSON.parse(jsonMatch[1]);
      } else {
        const jsonStr = findBalancedJSON(cleanedResponse);
        if (jsonStr) {
          console.log("✅ Found balanced JSON object");
          quizData = JSON.parse(jsonStr);
        } else {
          console.log("⚠️ Trying to parse entire response as JSON");
          quizData = JSON.parse(cleanedResponse);
        }
      }
      
      console.log("✅ Successfully parsed Java quiz:", {
        questionCount: quizData.questions?.length
      });
    } catch (parseError) {
      console.error("❌ JSON Parse Error:", parseError.message);
      const positionMatch = parseError.message.match(/position (\d+)/);
      if (positionMatch) {
        const pos = parseInt(positionMatch[1]);
        console.error("❌ Parse Error at position:", pos);
        console.error("❌ Context around error:", response.substring(Math.max(0, pos - 50), pos + 50));
      }
      console.error("❌ Failed Response (first 1000 chars):", response.substring(0, 1000));
      throw new Error(`Failed to parse quiz response: ${parseError.message}. Please try again.`);
    }

    if (!quizData.questions || !Array.isArray(quizData.questions)) {
      throw new Error("Invalid quiz format received from API");
    }

    if (quizData.questions.length !== numQuestions) {
      console.warn(`⚠️ Expected ${numQuestions} questions, got ${quizData.questions.length}`);
    }

    return quizData.questions;
  } catch (error) {
    console.error("Java quiz generation error:", error);
    throw error;
  }
}

export async function generateHistoricalPracticeQuestions({
  studentAnalytics,
  pastEvaluations = [],
  count = 5,
}) {
  const systemPrompt = `You are an expert Java programming instructor creating personalized practice questions.
Generate questions that address the student's weak areas while building on their strengths.`;

  const weakTopics = Object.entries(studentAnalytics?.topics || {})
    .filter(([_, data]) => data.strength === "weak" || data.score < 50)
    .map(([topic, _]) => topic);

  const strongTopics = Object.entries(studentAnalytics?.topics || {})
    .filter(([_, data]) => data.strength === "strong" || data.score >= 75)
    .map(([topic, _]) => topic);

  const userPrompt = `Generate ${count} Java practice questions for a student with the following profile:

**Weak Topics (focus here):**
${weakTopics.join(", ") || "General Java fundamentals"}

**Strong Topics (can build on):**
${strongTopics.join(", ") || "None identified yet"}

**Past Performance Summary:**
${pastEvaluations.length > 0
  ? `- ${pastEvaluations.length} previous contests evaluated
- Average score: ${(pastEvaluations.reduce((sum, e) => sum + (e.overallScore || 0), 0) / pastEvaluations.length).toFixed(1)}/100`
  : "No previous evaluations"}

Provide questions in JSON array format:
[
  {
    "title": "Question title",
    "description": "Detailed problem description",
    "codeTemplate": "// Starter code template",
    "testCases": [{"input": "...", "expectedOutput": "..."}],
    "topics": ["topic1", "topic2"],
    "difficulty": "easy|medium|hard"
  },
  ...
]

Focus on weak topics but vary difficulty. Include edge cases in test cases.`;

  try {
    const response = await callGeminiAPI(systemPrompt, userPrompt, {
      temperature: 0.6, // Balanced for creativity and speed
      max_tokens: 6000, // Fixed token limit
    });

    let questions;
    try {
      const jsonMatch = response.match(/```(?:json)?\s*(\[[\s\S]*\])\s*```/);
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[1]);
      } else {
        questions = JSON.parse(response);
      }
    } catch (parseError) {
      console.warn("Failed to parse practice questions as JSON");
      questions = [];
    }

    return Array.isArray(questions) ? questions.slice(0, count) : [];
  } catch (error) {
    console.error("Practice question generation error:", error);
    return [];
  }
}

/**
 * Generate comprehensive historical report
 * @param {Object} params - Report parameters
 * @param {Array} params.allEvaluations - All past contest evaluations
 * @param {Object} params.topicAnalytics - Current topic analytics
 * @returns {Promise<Object>} Comprehensive report
 */
export async function generateHistoricalReport({ allEvaluations, topicAnalytics }) {
  const systemPrompt = `You are an expert Java programming instructor creating a comprehensive student progress report.
Analyze trends, identify patterns, and provide actionable insights.`;

  const evaluationsSummary = allEvaluations.map((e, i) => ({
    contest: e.contestTitle || `Contest ${i + 1}`,
    score: e.overallScore || 0,
    strengths: e.strengths || [],
    weaknesses: e.weaknesses || [],
    topics: Object.keys(e.topicScores || {}),
  }));

  const userPrompt = `Create a comprehensive progress report for a Java student. This report should cover ALL contests and interviews from the first to the last.

**All Contest Evaluations (${allEvaluations.length} total):**
${JSON.stringify(evaluationsSummary, null, 2)}

**Current Topic Analytics:**
${JSON.stringify(topicAnalytics?.topics || {}, null, 2)}

**Important:** This report should include:
1. Vedam Merit Score calculation and breakdown
2. Complete performance analysis from first contest to last
3. Interview performance (if available)
4. Overall progress trends

Provide a detailed report in JSON format:
{
  "summary": "Overall performance summary paragraph covering all contests from first to last",
  "vedamMeritScore": {
    "total": 0-100,
    "breakdown": {
      "contestScore": "Score from contests (out of 40)",
      "mockScore": "Score from mock interviews (out of 60)",
      "explanation": "How the score was calculated"
    }
  },
  "trends": {
    "improving": ["topic1", "topic2"],
    "declining": ["topic3"],
    "stable": ["topic4"]
  },
  "strengths": ["overall strength 1", "overall strength 2"],
  "weaknesses": ["overall weakness 1", "overall weakness 2"],
  "recommendations": ["recommendation 1", "recommendation 2"],
  "nextSteps": ["action item 1", "action item 2"],
  "contestHistory": "Summary of performance across all contests from first to last"
}`;

  try {
    const response = await callGeminiAPI(systemPrompt, userPrompt, {
      temperature: 0.5, // Lower for faster, more focused reports
      max_tokens: 6000, // Fixed token limit
    });

    let report;
    try {
      const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        report = JSON.parse(jsonMatch[1]);
      } else {
        report = JSON.parse(response);
      }
    } catch (parseError) {
      console.warn("Failed to parse report as JSON, using fallback");
      report = {
        summary: response,
        trends: {},
        strengths: [],
        weaknesses: [],
        recommendations: [],
        nextSteps: [],
      };
    }

    return report;
  } catch (error) {
    console.error("Report generation error:", error);
    throw error;
  }
}

/**
 * Generate Java Coding Practice Questions using Gemini API
 * @param {Object} params - Question parameters
 * @param {string} params.topics - Comma-separated topics (e.g., "Arrays, Strings, OOP")
 * @param {string} params.difficulty - "easy", "medium", or "hard"
 * @returns {Promise<Array>} Array of 5 coding questions
 */
export async function generateJavaCodingQuestions({ topics, difficulty }) {
  const systemPrompt = `You are an expert Java programming instructor creating coding practice questions. 
Return ONLY valid JSON, no markdown, no explanations.`;

  const difficultyGuidelines = {
    easy: "🟢 EASY: Straightforward logic, basic arrays/strings, one-loop solutions, very few edge cases. Examples: reverse array, sum of numbers, check palindrome.",
    medium: "🟡 MEDIUM: Requires some thinking, uses common patterns (two pointers, sliding window, hashing, BFS/DFS), multiple edge cases. Examples: longest substring, binary search problems, BFS grid problems.",
    hard: "🔴 HARD: Multiple algorithms combined, advanced DP, graphs, trees, backtracking, many edge cases. Examples: N-Queens, DP on trees, Dijkstra variants, segment trees."
  };

  const userPrompt = `Generate exactly 5 Java coding practice questions on the topics: "${topics}".

Difficulty level: ${difficulty}
${difficultyGuidelines[difficulty]}

For each question, provide:
1. A clear problem description
2. A code template with method signature
3. Exactly 3 test cases with input and expected output
4. Difficulty classification (easy, medium, or hard)

IMPORTANT: For test case inputs:
- If the input contains an array, format it as:
  - First line: array length (e.g., "3")
  - Second line: array values separated by spaces (e.g., "1 2 3")
  - Example: "3\n1 2 3" for an array of length 3 with values [1, 2, 3]
- For single values, just provide the value (e.g., "5")
- For empty arrays, use "0\n" (length 0, no values)
- Use newline character (\n) to separate length and values

Return ONLY this JSON format (no markdown):
{
  "questions": [
    {
      "id": 1,
      "title": "Question title",
      "description": "Detailed problem description with examples",
      "codeTemplate": "public class Solution {\n    public int methodName(int[] arr) {\n        // Your code here\n        return 0;\n    }\n}",
      "testCases": [
        {
          "input": "3\n1 2 3",
          "expectedOutput": "6"
        },
        {
          "input": "0\n",
          "expectedOutput": "0"
        },
        {
          "input": "1\n5",
          "expectedOutput": "5"
        }
      ],
      "difficulty": "easy"
    }
  ]
}

Rules:
- Generate exactly 5 questions
- Each question must have exactly 3 test cases
- Test cases should cover edge cases
- Code template should include proper method signature
- All questions must relate to: ${topics}
- Difficulty must match: ${difficulty}
- Questions should progress from simpler to more complex`;

  try {
    const response = await callGeminiAPI(systemPrompt, userPrompt, {
      temperature: 0.7,
      max_tokens: 8000,
    });

    // Parse JSON response
    let questionData;
    try {
      console.log("🤖 Java Coding Questions Raw Response (first 500 chars):", response.substring(0, 500));
      
      let cleanedResponse = response.trim();
      
      // Clean up unescaped newlines and control characters in JSON strings
      // Helper function to escape JSON string content
      const escapeJsonString = (str) => {
        return str
          .replace(/\\/g, '\\\\')  // Escape backslashes first
          .replace(/"/g, '\\"')     // Escape quotes
          .replace(/\n/g, '\\n')    // Escape newlines
          .replace(/\r/g, '\\r')    // Escape carriage returns
          .replace(/\t/g, '\\t')    // Escape tabs
          .replace(/\f/g, '\\f')    // Escape form feeds
          .replace(/\v/g, '\\v');   // Escape vertical tabs
      };
      
      // Fix codeTemplate fields - they often have unescaped newlines
      // Use [\s\S] to match any character including newlines, non-greedy with lookahead
      cleanedResponse = cleanedResponse.replace(/"codeTemplate"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/g, (match, content) => {
        const escaped = escapeJsonString(content);
        return `"codeTemplate": "${escaped}"`;
      });
      
      // Fix test case input fields that might have unescaped newlines
      cleanedResponse = cleanedResponse.replace(/"input"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/g, (match, content) => {
        const escaped = escapeJsonString(content);
        return `"input": "${escaped}"`;
      });
      
      // Fix description fields that might have unescaped newlines
      cleanedResponse = cleanedResponse.replace(/"description"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/g, (match, content) => {
        const escaped = escapeJsonString(content);
        return `"description": "${escaped}"`;
      });
      
      const findBalancedJSON = (str) => {
        let start = str.indexOf('{');
        if (start === -1) return null;
        
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = start; i < str.length; i++) {
          const char = str[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') {
              depth++;
            } else if (char === '}') {
              depth--;
              if (depth === 0) {
                return str.substring(start, i + 1);
              }
            }
          }
        }
        
        return null;
      };
      
      const jsonMatch = cleanedResponse.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        console.log("✅ Found JSON in code fence");
        questionData = JSON.parse(jsonMatch[1]);
      } else {
        const jsonStr = findBalancedJSON(cleanedResponse);
        if (jsonStr) {
          console.log("✅ Found balanced JSON object");
          questionData = JSON.parse(jsonStr);
        } else {
          console.log("⚠️ Trying to parse entire response as JSON");
          questionData = JSON.parse(cleanedResponse);
        }
      }
      
      // Post-process: Convert escaped newlines back to actual newlines in codeTemplate for display
      if (questionData.questions) {
        questionData.questions = questionData.questions.map(q => ({
          ...q,
          codeTemplate: q.codeTemplate?.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r') || q.codeTemplate,
          testCases: q.testCases?.map(tc => ({
            ...tc,
            input: tc.input?.replace(/\\n/g, '\n') || tc.input,
          })) || q.testCases,
        }));
      }
      
      console.log("✅ Successfully parsed Java coding questions:", {
        questionCount: questionData.questions?.length
      });
    } catch (parseError) {
      console.error("❌ JSON Parse Error:", parseError.message);
      const positionMatch = parseError.message.match(/position (\d+)/);
      if (positionMatch) {
        const pos = parseInt(positionMatch[1]);
        console.error("❌ Parse Error at position:", pos);
        console.error("❌ Context around error:", cleanedResponse.substring(Math.max(0, pos - 50), pos + 50));
      }
      console.error("❌ Failed Response (first 1000 chars):", response.substring(0, 1000));
      throw new Error(`Failed to parse questions response: ${parseError.message}. Please try again.`);
    }

    if (!questionData.questions || !Array.isArray(questionData.questions)) {
      throw new Error("Invalid questions format received from API");
    }

    if (questionData.questions.length !== 5) {
      console.warn(`⚠️ Expected 5 questions, got ${questionData.questions.length}`);
    }

    return questionData.questions;
  } catch (error) {
    console.error("Java coding questions generation error:", error);
    throw error;
  }
}

/**
 * Analyze question to identify topics using Gemini API
 * @param {Object} params - Question parameters
 * @param {string} params.title - Question title
 * @param {string} params.description - Question description
 * @param {string} params.expectedSolution - Reference solution code
 * @param {Array} params.testCases - Test cases array
 * @returns {Promise<Array<string>>} Array of normalized topic names (e.g., ["arrays", "loops", "conditional statements"])
 */
export async function analyzeQuestionTopics({ title, description, expectedSolution, testCases }) {
  const systemPrompt = `You are an expert Java programming instructor analyzing coding questions to identify topics.
Return ONLY a JSON array of topic names, no markdown, no explanations.`;

  const userPrompt = `Analyze the following Java coding question and identify ALL relevant topics:

**Title:** ${title || "Untitled"}

**Description:**
${description || "No description provided"}

**Reference Solution:**
\`\`\`java
${expectedSolution || "// No solution provided"}
\`\`\`

**Test Cases:**
${Array.isArray(testCases) && testCases.length > 0
  ? testCases.map((tc, i) => {
      const input = tc?.input || tc?.inputValue || "";
      const output = tc?.expectedOutput || tc?.output || "";
      return `Test ${i + 1}: Input="${input}", Expected="${output}"`;
    }).join("\n")
  : "No test cases provided"}

Return a JSON array of topic names. Each topic should be a common Java programming concept.
Examples: "arrays", "2d arrays", "strings", "loops", "conditional statements", "hashmap", "recursion", "dynamic programming", "graphs", "trees", "sorting", "searching", "object-oriented programming", "inheritance", "polymorphism", "exception handling", etc.

Return ONLY this format (no markdown):
["topic1", "topic2", "topic3"]

Identify 1-5 relevant topics. Be specific but use common topic names.`;

  try {
    const response = await callGeminiAPI(systemPrompt, userPrompt, {
      temperature: 0.3, // Lower temperature for more consistent topic identification
      max_tokens: 500, // Small response needed
      timeout: 30000, // 30 second timeout
    });

    // Parse JSON response
    let topics = [];
    try {
      let cleanedResponse = response.trim();
      
      // Remove markdown code fences if present
      const jsonMatch = cleanedResponse.match(/```(?:json)?\s*(\[[\s\S]*\])\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        topics = JSON.parse(jsonMatch[1]);
      } else {
        // Try parsing the entire response as JSON
        topics = JSON.parse(cleanedResponse);
      }

      // Validate it's an array
      if (!Array.isArray(topics)) {
        console.warn('analyzeQuestionTopics: Response is not an array, converting');
        topics = [topics].filter(Boolean);
      }

      // Normalize topic names (lowercase, trim)
      topics = topics
        .filter(t => t && typeof t === 'string')
        .map(t => t.toLowerCase().trim())
        .filter(t => t.length > 0);

      console.log(`✅ analyzeQuestionTopics: Identified ${topics.length} topics:`, topics);
      return topics;
    } catch (parseError) {
      console.warn('analyzeQuestionTopics: Failed to parse response as JSON:', parseError.message);
      console.warn('Raw response:', response.substring(0, 200));
      // Return empty array on parse failure (non-blocking)
      return [];
    }
  } catch (error) {
    console.error('analyzeQuestionTopics error:', error);
    // Return empty array on error (non-blocking)
    return [];
  }
}

