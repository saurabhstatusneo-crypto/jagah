import os
import re
import pathlib
import sys

try:
    from groq import Groq
except ImportError:
    print("🚨 Please install 'groq': pip install groq")
    sys.exit(1)

API_KEY = os.environ.get("GROQ_API_KEY")
if not API_KEY:
    API_KEY = "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"
if not API_KEY:
    raise Exception("❌ Missing GROQ_API_KEY")

groq_client = Groq(api_key=API_KEY)

DB_PATTERNS = [
    r"EntityManager", r"JdbcTemplate", r"Connection",
    r"PreparedStatement", r"ResultSet", r"@Repository",
    r"@Entity", r"JpaRepository", r"CrudRepository",
    r"\.save\(", r"\.find", r"\.persist", r"\.merge", r"\.query"
]

METHOD_REGEX = re.compile(
    r"(?:public|protected|private)\s+[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*\{",
    re.MULTILINE
)

IMPORT_MAP = {
    "Assertions.": "import org.junit.jupiter.api.Assertions;",
    "assertTrue": "import static org.junit.jupiter.api.Assertions.assertTrue;",
    "assertFalse": "import static org.junit.jupiter.api.Assertions.assertFalse;",
    "assertEquals": "import static org.junit.jupiter.api.Assertions.assertEquals;",
    "assertThrows": "import static org.junit.jupiter.api.Assertions.assertThrows;",
    "@Test": "import org.junit.jupiter.api.Test;",
    "Mockito": "import org.mockito.Mockito;",
    "@Mock": "import org.mockito.Mock;",
    "@InjectMocks": "import org.mockito.InjectMocks;",
    "ExtendWith": "import org.junit.jupiter.api.extension.ExtendWith;",
    "MockitoExtension": "import org.mockito.junit.jupiter.MockitoExtension;",
}


def clean_java_code(code: str) -> str:
    """Remove markdown, normalize blank lines, strip trailing spaces."""
    code = code.strip()
    code = re.sub(r"^```(?:java)?\s*", "", code, flags=re.IGNORECASE)
    code = re.sub(r"```$", "", code)
    # Normalize multiple blank lines
    code = re.sub(r"\n\s*\n\s*\n", "\n\n", code)
    return code.strip()


def has_database_interaction(code: str) -> bool:
    return any(re.search(pattern, code) for pattern in DB_PATTERNS)


def extract_method_names(code: str):
    return METHOD_REGEX.findall(code)


def detect_db_method_names(code: str):
    # Only include methods that actually exist
    return [m for m in extract_method_names(code) if has_database_interaction(code)]


def should_skip_file(code: str) -> bool:
    return bool(re.search(
        r"@RestController|@Controller|@ControllerAdvice|@RestControllerAdvice|@SpringBootApplication|@Configuration|@Component",
        code
    ))


def add_missing_imports(code: str, pkg: str, class_name: str) -> str:
    """Ensure package first, then imports."""
    package_match = re.search(r"^(package\s+[\w\.]+;)", code, re.MULTILINE)
    package_line = package_match.group(1) if package_match else ""
    code_body = code
    if package_line:
        code_body = code[package_match.end():].strip()

    # Determine needed imports
    needed_imports = [
        imp for keyword, imp in IMPORT_MAP.items()
        if keyword in code_body and imp not in code_body
    ]

    if f"{class_name}" in code_body and f"import {pkg}.{class_name};" not in code_body:
        needed_imports.append(f"import {pkg}.{class_name};")

    import_block = "\n".join(sorted(set(needed_imports))) if needed_imports else ""

    final_code = ""
    if package_line:
        final_code += f"{package_line}\n\n"
    if import_block:
        final_code += f"{import_block}\n\n"
    final_code += code_body

    return final_code.strip()


def generate_test_with_ai(java_code: str, class_name: str, package_name: str) -> str:
    uses_db = has_database_interaction(java_code)
    db_methods = detect_db_method_names(java_code)

    if uses_db:
        test_type_instruction = "Write a COMPLETE JUnit-5 Mockito based test class without markdown code fences."
        mockito_rules = f"""
This class interacts with the database and requires isolation.
MUST USE MOCKITO.
- Use @ExtendWith(MockitoExtension.class)
- Use @Mock for dependencies and @InjectMocks for the class being tested
- Only mock these methods: {', '.join(db_methods) if db_methods else 'All'}
"""
    else:
        test_type_instruction = "Write a COMPLETE JUnit-5 simple unit test class without markdown code fences."
        mockito_rules = f"""
This class has NO external dependencies (pure business logic).
DO NOT USE MOCKITO (@Mock, @InjectMocks, @ExtendWith, Mockito.when/verify)
The class under test must be instantiated directly using 'new {class_name}()'
"""

    prompt = f"""
You are a senior Java engineer.
{test_type_instruction}
Rules:
✔ Package: {package_name}.tests
✔ Class name: {class_name}Test
✔ Test ALL public methods
✔ Use descriptive test method names
✔ Include positive, negative & edge cases
✔ Use meaningful assertions
Java Source Code:
{java_code}
{mockito_rules}
"""
    response = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        temperature=0.3,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )
    generated = clean_java_code(response.choices[0].message.content)
    return add_missing_imports(generated, package_name, class_name)


def process_java_files(root_dir="src/main/java"):
    if not os.path.isdir("src/test/java"):
        os.makedirs("src/test/java")

    for root, _, files in os.walk(root_dir):
        for filename in files:
            if not filename.endswith(".java"):
                continue

            full_path = os.path.join(root, filename)
            with open(full_path, "r", encoding="utf-8") as f:
                java_code = f.read()

            if should_skip_file(java_code):
                print(f"⏩ SKIPPED: {filename}")
                continue

            class_name = filename[:-5]
            pkg_match = re.search(r"package\s+([\w\.]+);", java_code)
            pkg = pkg_match.group(1) if pkg_match else "default"

            print(f"\n🧠 Generating tests for: {class_name} in package {pkg}")

            try:
                test_code = generate_test_with_ai(java_code, class_name, pkg)
                output_dir = pathlib.Path("src/test/java") / pathlib.Path(*pkg.split("."), "tests")
                output_dir.mkdir(parents=True, exist_ok=True)
                output_file = output_dir / f"{class_name}Test.java"
                with open(output_file, "w", encoding="utf-8") as out:
                    out.write(test_code)
                print(f"✔ Saved → {output_file}")
            except Exception as e:
                print(f"❌ ERROR [{class_name}]: {e}")


if __name__ == "__main__":
    process_java_files()
    print("\n🎉 Completed AI Test Generation Successfully")
