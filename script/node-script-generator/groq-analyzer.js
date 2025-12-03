import { Groq } from 'groq-sdk';
import path from 'path';


const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.error(" GROQ_API_KEY is NOT set!");
} else {
  const maskedKey = apiKey.slice(0, 4) + "****" + apiKey.slice(-4);
  console.log("🔑 GROQ_API_KEY Loaded:", maskedKey);
}

class GroqAIAnalyzer {
  constructor(config) {
    this.config = config;
    this.groq = new Groq({
      apiKey: this.config.get('groq.apiKey'),
    });
  }

  async analyzeCode(code, filePath) {
    if (!code || typeof code !== 'string') {
      return {
        success: false,
        error: 'Invalid code provided',
        file: filePath,
      };
    }

    try {
      const prompt = `Review this code and provide:
1. One-line summary of what it does
2. One potential issue to fix
3. Improved version with fixes

Code:\n\`\`\`\n${code}\n\`\`\``;

      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content:
              'You are a senior software engineer reviewing code. Provide clear, concise feedback and improved code when possible.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        model: this.config.get('groq.model') || 'llama-3.1-8b-instant',
        temperature: 0.3,
        max_tokens: 1000,
      });

      const response = completion.choices[0]?.message?.content || 'No response';

      // Extract improved code if present
      const improvedCode = this.extractCodeBlocks(response)[0] || code;

      // Extract issues and suggestions from AI response
      const issues = this.extractIssues(response);
      const suggestions = this.extractSuggestions(response);

      return {
        success: true,
        file: filePath,
        summary: response.split('\n')[0] || 'No summary',
        issue: issues.length > 0 ? issues[0].message : 'No major issues',
        improvedCode: improvedCode,
        fullResponse: response,
        issues: issues,
        suggestions: suggestions,
      };
    } catch (error) {
      console.error('Error in analyzeCode:', error);
      return {
        success: false,
        error: error.message,
        file: filePath,
      };
    }
  }

  extractSuggestions(analysis) {
    const suggestions = [];
    const lines = analysis.split('\n');
    for (const line of lines) {
      if (
        line.toLowerCase().includes('suggestion:') ||
        line.toLowerCase().includes('suggest:') ||
        line.toLowerCase().includes('recommend:') ||
        line.toLowerCase().includes('fix:') ||
        line.toLowerCase().includes('improve:')
      ) {
        const message = line.split(':').slice(1).join(':').trim();
        if (message) {
          suggestions.push({ type: 'suggestion', message });
        }
      }
    }
    return suggestions;
  }

  extractCodeBlocks(text) {
    if (!text) return [];

    const codeBlocks = [];
    const codeBlockRegex = /```(?:javascript|js|typescript|ts)?\n([\s\S]*?)\n```/g;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      codeBlocks.push(match[1]);
    }

    return codeBlocks.length > 0 ? codeBlocks : [];
  }

  extractIssues(analysis) {
    const issues = [];
    const lines = analysis.split('\n');
    for (const line of lines) {
      if (
        line.toLowerCase().includes('error:') ||
        line.toLowerCase().includes('warning:') ||
        line.toLowerCase().includes('issue:') ||
        line.toLowerCase().includes('problem:')
      ) {
        const message = line.split(':').slice(1).join(':').trim();
        if (message) {
          const severity = line.toLowerCase().includes('error:') ? 'error' : 'warning';
          issues.push({ severity, message });
        }
      }
    }
    return issues;
  }
  generateImports(code, filePath) {
    const imports = [];
    const issues = [];
    const classMatches = code.match(/class\s+(\w+)/g);
    if (classMatches) {
      classMatches.forEach((match) => {
        const className = match.replace('class ', '');
        // Check if this is in the same file we're testing
        if (filePath.endsWith('.js') && !filePath.includes('/__tests__/')) {
          const fileName = path.basename(filePath, '.js');

          // For exported classes - use normal import
          if (/\bmodule\.exports\s*=|exports\./.test(code)) {
            // Check if the class is actually exported
            const exportPattern = new RegExp(
              `module\\.exports\\s*=\\s*${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b|exports\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
            );
            if (exportPattern.test(code)) {
              imports.push(`const ${className} = require('../${path.basename(filePath)}');`);
            } else {
              issues.push(
                `Class '${className}' is not exported. Add 'module.exports = ${className};' to ${fileName}`
              );
            }
          } else {
            issues.push(
              `Class '${className}' is not exported. Add 'module.exports = ${className};' to ${path.basename(filePath)}`
            );
          }
        }
      });
    }

    // Check for function definitions (but not arrow functions or methods)
    const functionMatches = code.match(
      /^(?!.*=>.*)[ \t]*function\s+(\w+)[\s]*\(|^(?!.*=>.*)[ \t]*(\w+)[\s]*\([^)]*\)[\s]*\{/gm
    );
    if (functionMatches) {
      const exportedFunctions = [];

      functionMatches.forEach((match) => {
        const functionName = match
          .replace(/^(?!.*=>.*)[ \t]*function\s+/, '')
          .replace(/[\s]*\([^)]*\)[\s]*\{/, '')
          .replace(/^(?!.*=>.*)[ \t]*(\w+)[\s]*\([^)]*\)[\s]*\{/, '$1')
          .replace(/\($/, ''); // Remove trailing parenthesis

        if (functionName && filePath.endsWith('.js') && !filePath.includes('/__tests__/')) {
          // Check if this function is exported (either individually or in an object)
          const singleExportPattern = new RegExp(
            `module\\.exports\\s*=\\s*${functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b|exports\\.${functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*${functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
          );

          const objectExportPattern = /module\.exports\s*=\s*\{[\s\S]*\b\w+\s*,[\s\S]*\}/;

          if (singleExportPattern.test(code) || objectExportPattern.test(code)) {
            exportedFunctions.push(functionName);
          } else {
            issues.push(
              `Function '${functionName}' is not exported. Add it to module.exports in ${path.basename(filePath)}`
            );
          }
        }
      });

      // Generate appropriate import based on export style
      if (exportedFunctions.length > 0) {
        if (exportedFunctions.length === 1) {
          // Single function export
          imports.push(`const ${exportedFunctions[0]} = require('../${path.basename(filePath)}');`);
        } else {
          // Multiple functions - object destructuring
          const destructuredImports = exportedFunctions.map((fn) => fn).join(', ');
          imports.push(
            `const { ${destructuredImports} } = require('../${path.basename(filePath)}');`
          );
        }
      }
    }

    // Check for module imports dynamically
    const requireMatches = code.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    if (requireMatches) {
      const uniqueModules = [
        ...new Set(
          requireMatches
            .map((match) => {
              const moduleMatch = match.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
              return moduleMatch ? moduleMatch[1] : null;
            })
            .filter(Boolean)
        ),
      ];

      uniqueModules.forEach((moduleName) => {
        // Skip built-in Node.js modules that don't need explicit imports in tests
        const builtInModules = [
          'fs',
          'path',
          'os',
          'util',
          'events',
          'stream',
          'crypto',
          'url',
          'querystring',
          'http',
          'https',
        ];
        if (!builtInModules.includes(moduleName)) {
          imports.push(`const ${moduleName} = require('${moduleName}');`);
        }
      });
    }

    // Store issues for later reporting
    this.lastImportIssues = issues;

    return imports.join('\n');
  }

  analyzeCodeBehavior(code, filePath) {
    const analysis = {
      classes: [],
      functions: [],
      methods: [],
      stateVariables: [],
      edgeCases: [],
      errorConditions: [],
      filePath: filePath, // Store file path for debugging
    };

    // Analyze class definitions
    const classMatches = code.match(/class\s+(\w+).*?\{([\s\S]*)\}$/gm);
    if (classMatches) {
      classMatches.forEach((classMatch) => {
        const className = classMatch.match(/class\s+(\w+)/)[1];
        // Extract everything between the opening { and the closing } of the class
        const openBraceIndex = classMatch.lastIndexOf('{');
        const classBody = classMatch.substring(openBraceIndex + 1, classMatch.length - 1);

        const classInfo = {
          name: className,
          methods: [],
          constructor: null,
        };

        // Extract constructor
        const constructorMatch = classBody.match(/constructor\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/);
        if (constructorMatch) {
          classInfo.constructor = {
            params: constructorMatch[1].split(',').map((p) => p.trim()),
            body: constructorMatch[2].trim(),
          };
        }

        // Extract methods - look for method patterns within the class body
        const methodMatches = classBody.match(
          /(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\}(?=\s*(?:\w+\s*\(|\/\s*$))/g
        );
        if (methodMatches) {
          methodMatches.forEach((methodMatch) => {
            const methodName = methodMatch.match(/(\w+)\s*\(/)[1];
            const params = methodMatch.match(/\(([^)]*)\)/)[1];
            const body = methodMatch.match(/\{([\s\S]*?)\}/)[1];

            if (methodName !== 'constructor') {
              classInfo.methods.push({
                name: methodName,
                params: params
                  .split(',')
                  .map((p) => p.trim())
                  .filter((p) => p),
                body: body.trim(),
                isAsync: methodMatch.includes('async'),
                returnStatements: this.extractReturnStatements(body),
                stateChanges: this.analyzeStateChanges(body, className),
                errorHandling: this.analyzeErrorHandling(body),
              });
            }
          });
        }

        analysis.classes.push(classInfo);
      });
    }

    // Analyze function definitions
    const functionMatches = code.match(
      /^(?!.*=>.*)[ \t]*function\s+(\w+)[\s]*\(([^)]*)\)[\s]*\{([\s\S]*?)\}/gm
    );
    if (functionMatches) {
      functionMatches.forEach((funcMatch) => {
        const funcName = funcMatch.match(/function\s+(\w+)/)[1];
        const params = funcMatch.match(/\(([^)]*)\)/)[1];
        const body = funcMatch.match(/\{([\s\S]*?)\}/)[1];

        analysis.functions.push({
          name: funcName,
          params: params
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p),
          body: body.trim(),
          returnStatements: this.extractReturnStatements(body),
          errorHandling: this.analyzeErrorHandling(body),
        });
      });
    }

    return analysis;
  }

  extractReturnStatements(body) {
    const returns = [];
    const returnMatches = body.match(/return\s+([^;]+);?/g);
    if (returnMatches) {
      returnMatches.forEach((ret) => {
        const value = ret.match(/return\s+([^;]+);?/)[1].trim();
        returns.push(value);
      });
    }
    return returns;
  }

  analyzeStateChanges(body, className) {
    const changes = [];
    // Look for this.property assignments
    const assignments = body.match(/this\.(\w+)\s*=\s*([^;]+);?/g);
    if (assignments) {
      assignments.forEach((assignment) => {
        const match = assignment.match(/this\.(\w+)\s*=\s*([^;]+);?/);
        if (match) {
          changes.push({
            property: match[1],
            value: match[2].trim(),
            context: assignment.trim(),
            className: className, // Add class context for debugging
          });
        }
      });
    }
    return changes;
  }

  analyzeErrorHandling(body) {
    const errors = [];
    // Look for try-catch blocks
    const tryCatchMatches = body.match(/catch\s*\(\s*([^)]+)\s*\)\s*\{([\s\S]*?)\}/g);
    if (tryCatchMatches) {
      tryCatchMatches.forEach((catchBlock) => {
        const errorVar = catchBlock.match(/catch\s*\(\s*([^)]+)\s*\)/)[1];
        errors.push({ type: 'catch', variable: errorVar, block: catchBlock });
      });
    }

    // Look for error throwing
    const throwMatches = body.match(/throw\s+([^;]+);?/g);
    if (throwMatches) {
      throwMatches.forEach((throwMatch) => {
        const error = throwMatch.match(/throw\s+([^;]+);?/)[1].trim();
        errors.push({ type: 'throw', value: error });
      });
    }

    // Look for conditional returns
    const conditionals = body.match(/if\s*\(([^)]+)\)\s*return;/g);
    if (conditionals) {
      conditionals.forEach((cond) => {
        const condition = cond.match(/if\s*\(([^)]+)\)/)[1];
        errors.push({ type: 'conditional_return', condition });
      });
    }

    return errors;
  }

  generateTestSuiteName(filePath) {
    const baseName = path.basename(filePath, '.js');
    // Convert camelCase or kebab-case to Title Case for describe blocks
    return baseName
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());
  }

  async generateTests(code, filePath) {
    if (!code || typeof code !== 'string') {
      return {
        success: false,
        error: 'Invalid code provided',
        file: filePath,
      };
    }

    try {
      // Analyze the code behavior first
      const analysis = this.analyzeCodeBehavior(code, filePath);

      // Create detailed prompt based on analysis
      const prompt = this.createDetailedPrompt(code, filePath, analysis);

      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content:
              'You are an expert JavaScript developer specializing in writing comprehensive unit tests. Generate complete Jest tests that accurately reflect the actual behavior of the provided code. Do not make assumptions about behavior - test exactly what the code does.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        model: this.config.get('groq.model') || 'llama-3.1-8b-instant',
        temperature: 0.1, // Lower temperature for more accurate tests
        max_tokens: 4000,
      });

      const response = completion.choices[0]?.message?.content || '';

      // Extract test code from response
      const testCode = this.extractCodeBlocks(response)[0] || '';

      if (!testCode) {
        return {
          success: false,
          error: 'No test code generated',
          file: filePath,
          fullResponse: response.substring(0, 500),
        };
      }

      // Validate generated tests against analysis
      const validation = this.validateGeneratedTests(testCode, analysis);

      if (!validation.isValid) {
        return {
          success: false,
          error: `Generated tests don't match code behavior: ${validation.issues.join(', ')}`,
          file: filePath,
          suggestions: validation.suggestions,
          testCode: testCode,
        };
      }

      // Check for import issues and provide helpful error messages
      if (this.lastImportIssues && this.lastImportIssues.length > 0) {
        return {
          success: false,
          error: `Import issues detected: ${this.lastImportIssues.join(', ')}`,
          file: filePath,
          suggestions: this.lastImportIssues,
          testCode: testCode,
        };
      }

      return {
        success: true,
        file: filePath,
        testCode: testCode,
        fullResponse: response,
        analysis: analysis,
      };
    } catch (error) {
      console.error('Error in generateTests:', error);
      return {
        success: false,
        error: error.message,
        file: filePath,
      };
    } // Close catch block
  } // Close generateTests method

  createDetailedPrompt(code, filePath, analysis) {
    const isExported = /\bmodule\.exports\s*=|exports\./.test(code);
    const className = analysis.classes.length > 0 ? analysis.classes[0].name : 'UnknownClass';
    const functionName = analysis.functions.length > 0 ? analysis.functions[0].name : null;

    if (!isExported) {
      return `Generate comprehensive unit tests for this JavaScript code:

\`\`\`javascript
${code}
\`\`\`

CODE ANALYSIS:
${JSON.stringify(analysis, null, 2)}

IMPORTANT: This code does NOT export any modules. To enable proper testing, you have two options:

OPTION 1 - Add exports (RECOMMENDED):
Add 'module.exports = ${className || 'YourClassName'};' at the end of the file, then generate tests normally.

OPTION 2 - Alternative testing approach:
Since this code doesn't export modules, the tests would need to reference the classes/functions directly.

For now, I'll generate tests assuming exports will be added. If you prefer not to modify the original file, the tests will need manual adjustment.

IMPORTANT ADDITIONAL REQUIREMENTS:
1. The file does NOT export anything - it must be modified to add exports before these tests will work
2. After adding exports, the tests below will work correctly
3. Use exactly these variable names when creating instances in tests

\`\`\`javascript
// Test file for: ${path.basename(filePath)}
// Generated by AI Test Generator
// NOTE: This file doesn't export modules. Add 'module.exports = ${className || 'YourClassName'};' to enable these tests.

const { describe, test, expect } = require('@jest/globals');
// Import the ${className || 'YourClassName'} class - use '${className || 'YourClassName'}' as the variable name
const ${className || 'YourClassName'} = require('../${path.basename(filePath)}');

describe('${this.generateTestSuiteName(filePath)}', () => {
  // Test the ${className || 'YourClassName'} class that was imported above
  // Use '${className || 'YourClassName'}' (uppercase) as the variable name throughout the tests

  describe('core functionality', () => {
    // Test basic ${className ? className.toLowerCase() : 'class'} operations
    test('should perform basic functionality', () => {
      // Arrange - set up test data
      // Act - call the method/function being tested
      // Assert - verify the expected behavior
    });
  });

  describe('edge cases', () => {
    // Test edge cases and error conditions
  });
});
\`\`\``;
    }

    // Traditional exported module testing
    let prompt = `Generate comprehensive unit tests for this JavaScript code:

\`\`\`javascript
${code}
\`\`\`

CODE ANALYSIS:
${JSON.stringify(analysis, null, 2)}

BEHAVIOR ANALYSIS INSTRUCTIONS:
Study this code carefully and understand EXACTLY what each method and function does by tracing through the logic:

1. For each method, trace through the exact execution:
   - What are the initial state values?
   - What happens when each line executes?
   - What are the final state values after the method completes?

2. For state changes, be precise:
   - If a method modifies \`this.currentValue\`, test the EXACT modification that occurs
   - If a method calls other methods, test that the state changes match what actually happens

3. For edge cases, test what ACTUALLY happens:
   - If the code returns early under certain conditions, test that exact condition
   - If the code modifies state in specific ways, test those exact modifications
   - **SYSTEMATICALLY apply boundary value analysis**: Test values at the exact boundaries of input ranges, just above/below boundaries, and minimum/maximum values
   - **Apply equivalence class partitioning**: Identify input ranges that produce similar behavior and test representative values from each class

   BOUNDARY VALUE ANALYSIS REQUIREMENTS:
   - For numeric inputs: Test minimum value, maximum value, zero, negative values, and values just above/below key boundaries
   - For string inputs: Test empty strings, single characters, very long strings, and strings with special characters
   - For arrays: Test empty arrays, single-element arrays, and large arrays
   - For edge cases: Test null, undefined, and invalid input types that the code actually handles

   EQUIVALENCE CLASS PARTITIONING REQUIREMENTS:
   - **Valid inputs**: Identify ranges of inputs that produce the same behavior pattern
   - **Invalid inputs**: Identify ranges of inputs that trigger the same error handling
   - **Boundary inputs**: Test values that separate different behavioral classes

EXAMPLE: For a function that processes data:
- If the function transforms input in a specific way, test that exact transformation
- If the function has multiple code paths, test each path separately
- Tests should verify the actual output, not assume it should be different

CRITICAL: Test ONLY what the code actually does, not what you think it should do.

IMPORTANT REQUIREMENTS:
1. Use Jest testing framework with CommonJS require syntax
2. Test EXACTLY what the code does - no assumptions about intended behavior
3. For each method, test the specific state changes that actually occur
4. Use descriptive test names that reflect the ACTUAL functionality observed
5. Test edge cases that ACTUALLY exist in the code execution paths
6. Test error conditions exactly as they are implemented

CRITICAL INSTRUCTIONS:
7. Use the EXACT variable name "${className || functionName}" when creating instances in tests
8. Do NOT use different variable names - always use "${className || functionName}"
9. The imported variable refers to the ${className ? 'class' : 'function'} from the source file
10. Test the imported ${className ? 'class' : 'function'} - do NOT test assumptions about how it should work

FORMATTING AND CODE QUALITY REQUIREMENTS:
11. Generate PERFECT code that passes ESLint and Prettier without any modifications
12. Use consistent indentation (2 spaces, no tabs)
13. Use single quotes for strings, double quotes only when single quotes are inside
14. Add proper semicolons at the end of statements
15. Use trailing commas in objects and arrays where appropriate
16. Ensure proper spacing around operators and keywords
17. End the file with a single newline character
18. Use consistent variable naming (camelCase)
19. Keep line length under 100 characters when possible
20. Use meaningful variable names in tests (calculator, result, etc.)
21. Ensure all test blocks are properly closed with correct indentation

\`\`\`javascript
// Test file for: ${path.basename(filePath)}
// Generated by AI Test Generator
// Tests verify EXACT code behavior, no assumptions

const { describe, test, expect } = require('@jest/globals');
// Import the ${className || functionName} ${className ? 'class' : 'function'}
const ${className || functionName} = require('../${path.basename(filePath)}');

describe('${this.generateTestSuiteName(filePath)}', () => {
  describe('methodName', () => {
    test('should perform expected behavior', () => {
      const instance = new ${className || functionName}();
      const result = instance.methodName('param1', 'param2');
      expect(result).toBe('expectedValue');
    });

    test('should handle edge cases', () => {
      const instance = new ${className || functionName}();
      expect(() => instance.methodName('invalid')).toThrowError('Error message');
    });
  });
});
\`\`\`

FORMATTING EXAMPLE - Follow this exact pattern:
- Use 2-space indentation consistently
- End each statement with semicolon
- Use single quotes for strings
- Proper spacing around operators
- Meaningful variable names
- Proper test structure with describe/test blocks
- End file with single newline

  describe('boundary value analysis', () => {
    // Test values at exact boundaries, just above/below boundaries, min/max values
    // For numeric inputs: test minimum, maximum, zero, negative boundaries
    // For each boundary, test the exact behavior that occurs in the code
  });

  describe('equivalence class partitioning', () => {
    // Test representative values from each input class that produces similar behavior
    // Valid inputs: test values that follow the same execution path
    // Invalid inputs: test values that trigger the same error handling
    // Boundary inputs: test values that separate different behavioral classes
  });

  describe('exact behavior verification', () => {
    // Test methods based on ACTUAL code analysis above
    // Each test verifies the precise state changes that occur
    test('should demonstrate exact method behavior based on code analysis', () => {
      // Arrange - set up initial state exactly as code expects
      // Act - call the method exactly as implemented
      // Assert - verify the exact state changes that occur in the code
    });
  });

  describe('state change verification', () => {
    // Test that state changes match exactly what the code does
    // Example: if a method modifies state, test that exact modification
  });

  describe('edge case verification', () => {
    // Test edge cases that actually trigger different code paths
    // Based on the actual conditional logic in the code
  });
});
\`\`\`

FOCUS ON ACTUAL BEHAVIOR:
- If the code transforms data in specific ways, test those exact transformations
- If the code has conditional logic, test each condition path
- If the code modifies state in particular ways, test those exact modifications
- Do NOT assume methods work differently than they actually do`;

    return prompt;
  }
  extractCodeForInlineTesting(code) {
    // Extract class and function definitions for inline testing
    const lines = code.split('\n');
    const extractedLines = [];

    lines.forEach((line, index) => {
      // Include class definitions
      if (line.trim().startsWith('class ')) {
        // Find the end of the class
        let braceCount = 0;
        let inClass = false;
        for (let i = index; i < lines.length; i++) {
          extractedLines.push(lines[i]);
          if (lines[i].includes('{')) braceCount++;
          if (lines[i].includes('}')) braceCount--;
          if (braceCount === 0 && inClass) break;
          if (lines[i].trim().startsWith('class ')) inClass = true;
        }
      }
      // Include function definitions (but not arrow functions)
      else if (line.match(/^(?!.*=>.*)[ \t]*function\s+\w+/) && !line.includes('module.exports')) {
        extractedLines.push(line);
      }
    });

    return extractedLines.join('\n').trim();
  }

  validateGeneratedTests(testCode, analysis) {
    const issues = [];
    const suggestions = [];

    try {
      // Basic syntax validation
      new Function(testCode);
    } catch (error) {
      issues.push(`Syntax error in generated tests: ${error.message}`);
      suggestions.push('Check for proper JavaScript syntax in generated tests');
    }

    // Check if test structure matches code structure (more lenient)
    if (
      analysis.classes.length > 0 &&
      !testCode.includes('describe(') &&
      !testCode.includes('test(')
    ) {
      issues.push('Generated tests missing test structure for classes');
      suggestions.push('Ensure tests include describe or test blocks');
    }

    // Check for method coverage (more lenient)
    analysis.classes.forEach((cls) => {
      cls.methods.forEach((method) => {
        if (!testCode.includes(`.${method.name}(`) && !testCode.includes(`${method.name}(`)) {
          issues.push(`Missing test for method: ${cls.name}.${method.name}`);
          suggestions.push(`Add test for ${cls.name}.${method.name} method`);
        }
      });
    });

    // Check if tests are actually using imported functions/classes (more lenient)
    // Relaxed: do not require tests to directly reference detected classes/functions

    // Enhanced behavior validation
    this.validateBehaviorAlignment(testCode, analysis, issues, suggestions);

    // Relaxed: do not enforce using class methods over raw operations

    return {
      isValid: issues.length === 0,
      issues,
      suggestions,
    };
  }

  validateBehaviorAlignment(testCode, analysis, issues, suggestions) {
    // Generic validation that works for any code, not just calculators

    // 1. Check for method calls that might indicate incorrect assumptions
    analysis.classes.forEach((cls) => {
      cls.methods.forEach((method) => {
        // Check if tests are calling methods but expecting different behavior
        if (testCode.includes(`.${method.name}(`)) {
          // Look for patterns where tests might assume different method behavior
          this.validateMethodBehavior(testCode, method, issues, suggestions);
        }
      });
    });

    // 2. Check for state management assumptions
    const stateChanges = analysis.classes.flatMap((cls) =>
      cls.methods.flatMap((method) => method.stateChanges)
    );

    if (stateChanges.length > 0) {
      // Look for tests that might be missing state change verification
      const testedProperties = testCode.match(/\.(\w+)\b/g);
      const expectedProperties = stateChanges.map((change) => change.property);

      const missingStateTests = expectedProperties.filter(
        (prop) => !testedProperties || !testedProperties.includes(`.${prop}`)
      );

      if (missingStateTests.length > 0) {
        issues.push(
          `Tests may not be verifying all state changes: ${missingStateTests.join(', ')}`
        );
        suggestions.push('Ensure tests verify all state changes that occur in the code');
      }
    }

    // 3. Check for return value assumptions
    const returnStatements = analysis.classes.flatMap((cls) =>
      cls.methods.flatMap((method) => method.returnStatements)
    );

    if (returnStatements.length > 0) {
      // Look for tests that might assume different return behavior
      if (testCode.includes('toBe(')) {
        const testExpectations = testCode.match(/expect\([^)]+\)\.toBe\(['"]([^'"]+)['"]\)/g);
        if (testExpectations) {
          // Check for patterns that might indicate incorrect assumptions
          this.validateReturnValueAssumptions(
            testCode,
            returnStatements,
            testExpectations,
            issues,
            suggestions
          );
        }
      }
    }

    // 4. Check for edge case coverage
    const edgeCases = analysis.classes.flatMap((cls) =>
      cls.methods.flatMap((method) => method.errorHandling)
    );

    if (edgeCases.length > 0) {
      // Look for tests that might be missing edge case verification
      const hasEdgeCaseTests =
        testCode.includes('null') ||
        testCode.includes('undefined') ||
        testCode.includes('NaN') ||
        testCode.includes('throw');

      if (!hasEdgeCaseTests && edgeCases.some((edge) => edge.type === 'conditional_return')) {
        issues.push('Tests may be missing edge case verification');
        suggestions.push('Ensure tests cover edge cases and error conditions present in the code');
      }
    }
  }

  validateMethodBehavior(testCode, method, issues, suggestions) {
    // Generic method behavior validation that works for any method

    // Check if the method modifies state and tests are verifying those changes
    if (method.stateChanges.length > 0) {
      const methodCallsInTests = testCode.match(new RegExp(`\\.${method.name}\\(`, 'g'));
      if (methodCallsInTests) {
        method.stateChanges.forEach((change) => {
          if (!testCode.includes(`.${change.property}`)) {
            issues.push(`Tests may not be verifying state changes in ${method.name} method`);
            suggestions.push(
              `Ensure tests verify the '${change.property}' state changes in ${method.name} method`
            );
          }
        });
      }
    }

    // Check for method call sequences that might indicate incorrect assumptions
    if (method.params.length > 0) {
      // Look for tests that call the method multiple times in sequence
      const methodCallPattern = new RegExp(`\\.${method.name}\\(.*?\\)`, 'g');
      const methodCalls = testCode.match(methodCallPattern);

      if (methodCalls && methodCalls.length > 1) {
        // Check if there are assumptions about method call ordering
        const testLines = testCode.split('\n');
        for (let i = 0; i < testLines.length - 1; i++) {
          if (testLines[i].includes(method.name) && testLines[i + 1].includes(method.name)) {
            // Check if the test assumes specific behavior between method calls
            const context = testLines.slice(i, i + 3).join('\n');
            if (context.includes('expect') && context.includes(method.name)) {
              issues.push(`Test may assume specific behavior between ${method.name} method calls`);
              suggestions.push(
                `Verify that the sequence of ${method.name} calls behaves as expected`
              );
            }
          }
        }
      }
    }
  }

  validateReturnValueAssumptions(
    testCode,
    returnStatements,
    testExpectations,
    issues,
    suggestions
  ) {
    // Generic return value validation
    testExpectations.forEach((expectation) => {
      const expectedValue = expectation.match(/toBe\(['"]([^'"]+)['"]\)/)[1];

      // Check if the expected value matches any of the actual return statements
      const matchingReturns = returnStatements.filter(
        (ret) =>
          ret.includes(expectedValue) ||
          ret.includes(`'${expectedValue}'`) ||
          ret.includes(`"${expectedValue}"`)
      );

      if (matchingReturns.length === 0) {
        // The test expects a value that doesn't appear in the actual return statements
        issues.push(
          `Test expects return value '${expectedValue}' that may not match actual code behavior`
        );
        suggestions.push(
          'Verify that test expectations match the actual return values in the code'
        );
      }
    });
  }

  formatGeneratedCode(testCode) {
    // For now, use basic formatting to avoid ES module complexity
    // In production, you could integrate with Prettier API directly
    return this.basicFormatCode(testCode);
  }

  basicFormatCode(testCode) {
    try {
      // Basic formatting fixes to ensure linting compliance
      let formatted = testCode;

      // Ensure file ends with single newline
      formatted = formatted.trim() + '\n';

      // Fix common indentation issues
      const lines = formatted.split('\n');
      let indentLevel = 0;
      const fixedLines = lines.map((line) => {
        // Skip empty lines
        if (line.trim() === '') return line;

        // Fix inconsistent indentation (convert tabs to spaces)
        let fixedLine = line.replace(/\t/g, '  ');

        // Calculate proper indentation based on context
        const trimmed = fixedLine.trim();

        // Decrease indent level for closing braces
        if (trimmed === '}' || trimmed === '});') {
          indentLevel = Math.max(0, indentLevel - 1);
        }

        // Apply proper indentation
        const properIndent = '  '.repeat(indentLevel);
        fixedLine = properIndent + trimmed;

        // Increase indent level for opening braces
        if (trimmed.endsWith('{') || trimmed.endsWith('{')) {
          indentLevel++;
        }

        // Ensure proper spacing around operators
        fixedLine = fixedLine
          .replace(/\s*=\s*/g, ' = ')
          .replace(/\s*\(\s*/g, '(')
          .replace(/\s*\)\s*/g, ')')
          .replace(/\s*{\s*/g, ' {')
          .replace(/\s*}\s*/g, '}')
          .replace(/\s*;\s*/g, ';')
          .replace(/\s*,\s*/g, ', ');

        // Fix spacing around keywords
        fixedLine = fixedLine
          .replace(/\s+if\s*\(/g, ' if (')
          .replace(/\s+for\s*\(/g, ' for (')
          .replace(/\s+while\s*\(/g, ' while (')
          .replace(/\s+function\s+/g, ' function ')
          .replace(/\s+const\s+/g, ' const ')
          .replace(/\s+let\s+/g, ' let ')
          .replace(/\s+var\s+/g, ' var ');

        // Fix malformed arrow functions
        fixedLine = fixedLine
          .replace(/\(\s*\)\s*=\s*>/g, '() =>')
          .replace(/\(\s*[^)]+\s*\)\s*=\s*>/g, (match) => {
            const params = match.match(/\(([^)]+)\)/)[1];
            return `(${params.trim()}) =>`;
          });

        return fixedLine;
      });

      return fixedLines.join('\n');
    } catch (error) {
      console.warn('Error in basic formatting:', error.message);
      return testCode;
    }
  }
} // Close class GroqAIAnalyzer

export default GroqAIAnalyzer;
