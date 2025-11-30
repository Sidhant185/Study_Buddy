/**
 * Cache utility functions for storing quiz and practice question data in localStorage
 */

const CACHE_KEYS = {
  QUIZ_MATHS: 'quiz_maths',
  QUIZ_WEB: 'quiz_web',
  QUIZ_JAVA: 'quiz_java',
};

/**
 * Get cached quiz data for a subject
 * @param {string} subject - 'maths', 'web', or 'java'
 * @returns {Object|null} Cached quiz data or null if not found
 */
export function getCachedQuiz(subject) {
  try {
    const key = CACHE_KEYS[`QUIZ_${subject.toUpperCase()}`];
    if (!key) return null;
    
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    
    return JSON.parse(cached);
  } catch (error) {
    console.error('Error reading quiz cache:', error);
    return null;
  }
}

/**
 * Store quiz data in cache
 * @param {string} subject - 'maths', 'web', or 'java'
 * @param {Object} data - Quiz data to cache
 * @param {Array} data.questions - Quiz questions
 * @param {Object} data.params - Quiz parameters (topic, difficulty, numQuestions)
 */
export function setCachedQuiz(subject, data) {
  try {
    const key = CACHE_KEYS[`QUIZ_${subject.toUpperCase()}`];
    if (!key) return;
    
    localStorage.setItem(key, JSON.stringify({
      questions: data.questions,
      params: data.params,
    }));
  } catch (error) {
    console.error('Error writing quiz cache:', error);
  }
}

/**
 * Get cached Java custom practice questions (single entry)
 * @returns {Object|null} Cached practice questions or null if not found
 */
export function getCachedJavaPractice() {
  try {
    const key = 'java_custom_practice';
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    
    return JSON.parse(cached);
  } catch (error) {
    console.error('Error reading Java practice cache:', error);
    return null;
  }
}

/**
 * Store Java custom practice questions in cache (single entry, overwrites previous)
 * @param {Object} params - Practice parameters
 * @param {string} params.topics - Comma-separated topics
 * @param {string} params.difficulty - Difficulty level
 * @param {Array} questions - Practice questions to cache
 */
export function setCachedJavaPractice(params, questions) {
  try {
    const key = 'java_custom_practice';
    localStorage.setItem(key, JSON.stringify({
      questions,
      params: {
        topics: params.topics,
        difficulty: params.difficulty,
      },
    }));
  } catch (error) {
    console.error('Error writing Java practice cache:', error);
  }
}

/**
 * Clear all quiz and practice caches
 */
export function clearAllCaches() {
  try {
    Object.values(CACHE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
    // Clear Java custom practice cache
    localStorage.removeItem('java_custom_practice');
  } catch (error) {
    console.error('Error clearing caches:', error);
  }
}

