/**
 * Piston API Service
 * Provides Java code execution via Piston API (https://github.com/engineer-man/piston)
 * 
 * Piston is a self-hosted code execution engine, but we'll use a public instance
 * For production, consider hosting your own or using JDoodle/Judge0
 */

const PISTON_API_URL = "https://emkc.org/api/v2/piston/execute";

/**
 * Execute Java code using Piston API
 * @param {string} code - Java source code
 * @param {Array<string>} stdin - Array of input strings for test cases
 * @returns {Promise<Object>} Execution result with stdout, stderr, exitCode
 */
export async function executeJavaCode(code, stdin = []) {
  try {
    const response = await fetch(PISTON_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        language: "java",
        version: "15.0.2", // Java version
        files: [
          {
            name: "Main.java",
            content: code,
          },
        ],
        stdin: stdin.join("\n") || "",
        args: [],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Piston API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    return {
      success: result.run?.exitCode === 0,
      stdout: result.run?.stdout || "",
      stderr: result.run?.stderr || "",
      exitCode: result.run?.exitCode || -1,
      output: result.run?.output || "",
      compileOutput: result.compile?.output || "",
      compileStderr: result.compile?.stderr || "",
    };
  } catch (error) {
    console.error("Piston execution error:", error);
    return {
      success: false,
      stdout: "",
      stderr: error.message || "Failed to execute code",
      exitCode: -1,
      output: "",
      compileOutput: "",
      compileStderr: "",
    };
  }
}

/**
 * Run test cases against Java code
 * @param {string} code - Java source code
 * @param {Array<Object>} testCases - Array of {input: string, expectedOutput: string}
 * @returns {Promise<Object>} Test results
 */
export async function runTestCases(code, testCases = []) {
  // Parameter validation
  if (!code || typeof code !== 'string') {
    console.error('runTestCases: Invalid code:', code);
    throw new Error('Code parameter is required and must be a string');
  }
  
  if (!Array.isArray(testCases)) {
    console.error('runTestCases: testCases is not an array:', testCases);
    throw new Error('testCases must be an array');
  }
  
  console.log(`🧪 runTestCases: Running ${testCases.length} test cases`);
  
  const results = [];
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    
    // Validate test case structure
    if (!testCase || typeof testCase !== 'object') {
      console.warn(`⚠️ runTestCases: Invalid test case ${i + 1}:`, testCase);
      results.push({
        testCaseNumber: i + 1,
        input: "",
        expectedOutput: "",
        actualOutput: "",
        passed: false,
        stderr: "Invalid test case structure",
        exitCode: -1,
      });
      failed++;
      continue;
    }
    
    const input = testCase.input || testCase.inputValue || "";
    const expectedOutput = testCase.expectedOutput || testCase.output || "";
    
    console.log(`🔍 runTestCases: Test ${i + 1} - Input: "${input}", Expected: "${expectedOutput}"`);
    
    const result = await executeJavaCode(code, [input]);
    
    const actualOutput = (result.stdout || "").trim();
    const expectedOutputTrimmed = expectedOutput.trim();
    const testPassed = actualOutput === expectedOutputTrimmed;

    results.push({
      testCaseNumber: i + 1,
      input: testCase.input || "",
      expectedOutput,
      actualOutput,
      passed: testPassed,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });

    if (testPassed) {
      passed++;
    } else {
      failed++;
    }
  }

  return {
    total: testCases.length,
    passed,
    failed,
    results,
    allPassed: failed === 0,
  };
}

/**
 * Validate Java code syntax (basic check via compilation)
 */
export async function validateJavaSyntax(code) {
  const result = await executeJavaCode(code, []);
  return {
    valid: result.exitCode === 0 && !result.compileStderr,
    compileError: result.compileStderr || result.stderr || null,
  };
}

