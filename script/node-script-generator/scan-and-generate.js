    import fs from "fs";
    import path from "path";
    import GroqAIAnalyzer from "../src/groq-analyzer.js";

    // Directories to skip
    const IGNORE_DIRS = ["node_modules", "dist", "build", "coverage", "test", "__tests__"];

    // File types to include
    const JS_EXT = [".js", ".jsx", ".mjs"];

    // Auto-recursive scanner
    function getJsFiles(dir) {
    let files = [];

    for (const item of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
        if (!IGNORE_DIRS.includes(item)) {
            files = files.concat(getJsFiles(fullPath));
        }
        } else if (JS_EXT.includes(path.extname(item))) {
        files.push(fullPath);
        }
    }

    return files;
    }

    async function main() {
    const analyzer = new GroqAIAnalyzer();
    const sourcePath = process.cwd();
    const jsFiles = getJsFiles(sourcePath);

    console.log(`🔍 Found ${jsFiles.length} JS files`);
    console.log(jsFiles);

    for (const file of jsFiles) {
        console.log(`⚙️ Generating tests for: ${file}`);

        try {
        await analyzer.generateTests(file); // Your existing function
        } catch (err) {
        console.error(`❌ Error generating test for ${file}:`, err.message);
        }
    }

    console.log("🎉 ALL TESTS GENERATED SUCCESSFULLY!");
    }

    main();
