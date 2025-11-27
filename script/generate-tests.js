/**
 *  AI-Powered JUnit Test Generator with Mockito Support
 * ------------------------------------------------------
 * Enhancements added:
 * 1. Auto-detect and add required import statements
 * 2. Skip Controller classes and @SpringBootApplication classes
 */

import fs from "fs";
import path from "path";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function cleanJavaCode(code) {
    return code.replace(/^```java\s*/, "").replace(/```$/, "").trim();
}

/** Detect database usage */
function hasDatabaseInteraction(javaCode) {
    const dbPatterns = [
        /EntityManager/, /JdbcTemplate/, /Connection/, /PreparedStatement/, /ResultSet/,
        /@Repository/, /@Entity/, /JpaRepository/, /CrudRepository/,
        /\.save\(/, /\.find/, /\.persist/, /\.merge/, /\.query/
    ];
    return dbPatterns.some((pattern) => pattern.test(javaCode));
}

/** Extract methods */
function extractMethods(javaCode) {
    const methodRegex = /(?:public|protected|private)\s+[\w\<\>\[\]]+\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)(?=\n\s*(?:public|protected|private|$))/g;
    const methods = [];
    let match;
    while ((match = methodRegex.exec(javaCode)) !== null) {
        methods.push({ name: match[1], body: match[2] });
    }
    return methods;
}

/** Detect methods touching DB */
function detectDbMethods(javaCode) {
    const methods = extractMethods(javaCode);
    return methods.filter((m) => hasDatabaseInteraction(m.body)).map((m) => m.name);
}

/** Detect if file should be skipped */
function shouldSkipFile(javaCode) {
    return /@RestController|@Controller/.test(javaCode) || /@SpringBootApplication/.test(javaCode) || /@Repository/.test(javaCode);
}

/** Detect required imports from generated test file */
function addMissingImports(testCode) {
    const importMap = {
        Assertions: "import org.junit.jupiter.api.Assertions;",
        Test: "import org.junit.jupiter.api.Test;",
        Mockito: "import org.mockito.Mockito;",
        Mock: "import org.mockito.Mock;",
        InjectMocks: "import org.mockito.InjectMocks;",
        ExtendWith: "import org.junit.jupiter.api.extension.ExtendWith;",
        MockitoExtension: "import org.mockito.junit.jupiter.MockitoExtension;",
    };

    let importsToAdd = [];

    Object.entries(importMap).forEach(([keyword, importStmt]) => {
        if (testCode.includes(keyword) && !testCode.includes(importStmt)) {
            importsToAdd.push(importStmt);
        }
    });

    return importsToAdd.join("\n") + "\n\n" + testCode;
}

/** AI Test generator */
async function generateTestWithAI(javaCode, className, packageName) {
    const classHasDb = hasDatabaseInteraction(javaCode);
    const dbMethods = detectDbMethods(javaCode);

    let mockitoInstructions = "";

    if (classHasDb || dbMethods.length > 0) {
        mockitoInstructions = `
Some methods interact with DB.
Use Mockito only for methods: ${dbMethods.join(", ") || "Entire class"}.
Use @Mock, @InjectMocks, @ExtendWith(MockitoExtension.class).
Use when(...).thenReturn(...) and verify(...).
`;
    }

    const prompt = `
You are a senior Java expert.
Generate a full valid JUnit 5 test class for this Java class.
Do NOT wrap inside markdown.
Follow these rules:
- Class name must be ${className}Test
- Package should match
- Include required imports (no unused imports)
- Test all public methods
${mockitoInstructions}

Java class:
${javaCode}
`;

    const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
        max_tokens: 4096,
    });

    let testCode = cleanJavaCode(completion.choices[0].message.content);
    testCode = addMissingImports(testCode);

    return testCode;
}

/** Recursive processor */
async function processJavaFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            await processJavaFiles(fullPath);
        } else if (entry.name.endsWith(".java")) {

            const javaCode = fs.readFileSync(fullPath, "utf8");

            if (shouldSkipFile(javaCode)) {
                console.log(`⏩ Skipped (controller or main app): ${entry.name}`);
                continue;
            }

            const className = path.basename(entry.name, ".java");
            const pkgMatch = javaCode.match(/package\s+([\w\.]+);/);
            const packageName = pkgMatch ? pkgMatch[1] : "default";

            console.log(`🧠 Generating test for: ${className}`);

            try {
                const testCode = await generateTestWithAI(javaCode, className, packageName);

                const testDir = path.join("src", "test", "java", ...packageName.split("."));
                fs.mkdirSync(testDir, { recursive: true });

                fs.writeFileSync(path.join(testDir, `${className}Test.java`), testCode);

                console.log(`✅ Saved test: ${className}Test`);
            } catch (err) {
                console.error(`❌ Failed for ${className}: ${err.message}`);
            }
        }
    }
}

await processJavaFiles("src/main/java");
console.log("\n🎉 Completed with AI + Mockito + Import Auto-Fix !");