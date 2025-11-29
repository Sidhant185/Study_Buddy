# JSON Format Guide for Contest Data Upload

This guide explains the JSON format for uploading contest data and student submissions.

## 1. Contest Data JSON Format

Use this format to upload contest questions, expected solutions, and test cases in one file.

### File Structure

```json
{
  "contestTitle": "Java Contest #1",
  "description": "Basic Java programming contest covering arrays and loops",
  "difficulty": "medium",
  "topics": ["arrays", "loops", "recursion"],
  "questions": [
    {
      "questionNumber": 1,
      "title": "Reverse a String",
      "description": "Write a function to reverse a given string. The function should take a string as input and return the reversed string.",
      "expectedSolution": "public class Solution {\n  public String reverse(String s) {\n    StringBuilder sb = new StringBuilder();\n    for (int i = s.length() - 1; i >= 0; i--) {\n      sb.append(s.charAt(i));\n    }\n    return sb.toString();\n  }\n}",
      "testCases": [
        {
          "input": "hello",
          "expectedOutput": "olleh"
        },
        {
          "input": "world",
          "expectedOutput": "dlrow"
        },
        {
          "input": "java",
          "expectedOutput": "avaj"
        }
      ],
      "maxScore": 20,
      "topics": ["strings", "loops"],
      "difficulty": "easy"
    },
    {
      "questionNumber": 2,
      "title": "Find Maximum in Array",
      "description": "Write a function to find the maximum element in an array of integers.",
      "expectedSolution": "public class Solution {\n  public int findMax(int[] arr) {\n    if (arr.length == 0) return Integer.MIN_VALUE;\n    int max = arr[0];\n    for (int i = 1; i < arr.length; i++) {\n      if (arr[i] > max) {\n        max = arr[i];\n      }\n    }\n    return max;\n  }\n}",
      "testCases": [
        {
          "input": "[1, 5, 3, 9, 2]",
          "expectedOutput": "9"
        },
        {
          "input": "[-10, -5, -20]",
          "expectedOutput": "-5"
        }
      ],
      "maxScore": 25,
      "topics": ["arrays", "algorithms"],
      "difficulty": "easy"
    }
  ]
}
```

### Field Descriptions

#### Root Level
- **contestTitle** (string, required): Title of the contest
- **description** (string, optional): Description of the contest
- **difficulty** (string, optional): "easy", "medium", or "hard" (default: "medium")
- **topics** (array of strings, optional): List of topics covered in the contest
- **questions** (array, required): Array of question objects

#### Question Object
- **questionNumber** (number, required): Question number (1, 2, 3, etc.)
- **title** (string, required): Question title
- **description** (string, required): Detailed problem description
- **expectedSolution** (string, required): Reference solution code in Java
- **testCases** (array, required): Array of test case objects
- **maxScore** (number, optional): Maximum score for this question (default: 0)
- **topics** (array of strings, optional): Topics for this specific question
- **difficulty** (string, optional): "easy", "medium", or "hard" (default: "medium")

#### Test Case Object
- **input** (string, required): Input value for the test case
- **expectedOutput** (string, required): Expected output value

### Example File

Save this as `contest_data.json`:

```json
{
  "contestTitle": "Java Fundamentals Contest",
  "description": "Basic Java programming concepts",
  "difficulty": "medium",
  "topics": ["arrays", "strings", "loops"],
  "questions": [
    {
      "questionNumber": 1,
      "title": "Reverse a String",
      "description": "Write a function to reverse a given string.",
      "expectedSolution": "public class Solution {\n  public String reverse(String s) {\n    return new StringBuilder(s).reverse().toString();\n  }\n}",
      "testCases": [
        {"input": "hello", "expectedOutput": "olleh"},
        {"input": "world", "expectedOutput": "dlrow"}
      ],
      "maxScore": 20,
      "topics": ["strings"],
      "difficulty": "easy"
    }
  ]
}
```

---

## 2. Student Submissions JSON Format

Use this format to upload multiple student submissions for a contest in one file.

### File Structure

```json
{
  "contestId": "contest_id_here",
  "submissions": [
    {
      "studentId": "student_id_1",
      "studentEmail": "student1@example.com",
      "questionNumber": 1,
      "code": "public class Solution {\n  public String reverse(String s) {\n    // Student's code here\n    return s;\n  }\n}"
    },
    {
      "studentId": "student_id_1",
      "studentEmail": "student1@example.com",
      "questionNumber": 2,
      "code": "public class Solution {\n  public int findMax(int[] arr) {\n    // Student's code here\n    return 0;\n  }\n}"
    },
    {
      "studentId": "student_id_2",
      "studentEmail": "student2@example.com",
      "questionNumber": 1,
      "code": "public class Solution {\n  public String reverse(String s) {\n    StringBuilder sb = new StringBuilder(s);\n    return sb.reverse().toString();\n  }\n}"
    }
  ]
}
```

### Field Descriptions

#### Root Level
- **contestId** (string, optional): Contest ID. If not provided, will use the currently selected contest.
- **submissions** (array, required): Array of submission objects

#### Submission Object
- **studentId** (string, optional): Student ID from database. If not provided, will look up by email.
- **studentEmail** (string, required if studentId not provided): Student's email address (used to find student)
- **questionNumber** (number, required): Question number (1, 2, 3, etc.) - must match question numbers in contest
- **code** (string, required): Student's submitted Java code

### Example File

Save this as `student_submissions.json`:

```json
{
  "submissions": [
    {
      "studentEmail": "john@example.com",
      "questionNumber": 1,
      "code": "public class Solution {\n  public String reverse(String s) {\n    char[] chars = s.toCharArray();\n    int left = 0, right = chars.length - 1;\n    while (left < right) {\n      char temp = chars[left];\n      chars[left] = chars[right];\n      chars[right] = temp;\n      left++;\n      right--;\n    }\n    return new String(chars);\n  }\n}"
    },
    {
      "studentEmail": "john@example.com",
      "questionNumber": 2,
      "code": "public class Solution {\n  public int findMax(int[] arr) {\n    int max = Integer.MIN_VALUE;\n    for (int num : arr) {\n      if (num > max) max = num;\n    }\n    return max;\n  }\n}"
    },
    {
      "studentEmail": "jane@example.com",
      "questionNumber": 1,
      "code": "public class Solution {\n  public String reverse(String s) {\n    return new StringBuilder(s).reverse().toString();\n  }\n}"
    }
  ]
}
```

---

## Notes

1. **File Encoding**: Save JSON files with UTF-8 encoding
2. **Code Formatting**: Code in `expectedSolution` and `code` fields should be properly formatted with newlines (`\n`)
3. **Test Cases**: Input and output should be strings. For arrays, use string representation like `"[1, 2, 3]"`
4. **Question Numbers**: Must be sequential starting from 1
5. **Student Lookup**: If `studentId` is not provided, the system will look up the student by email. If student doesn't exist, upload will fail for that submission.
6. **Automatic Evaluation**: All uploaded submissions will be automatically evaluated by AI

---

## Quick Start

1. **Upload Contest Data**:
   - Go to Admin Panel → Java Contests tab
   - Click "Upload Contest JSON" button
   - Select your `contest_data.json` file
   - Review the loaded data and submit

2. **Upload Student Submissions**:
   - Select a contest
   - Click "Upload Submissions JSON" button
   - Select your `student_submissions.json` file
   - Submissions will be uploaded and automatically evaluated

