import os
import re
import pathlib
import subprocess
import sys

try:
    from groq import Groq
except ImportError:
    print("🚨 Please install: pip install groq")
    sys.exit(1)

# =============================
# Groq Client
# =============================
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
# ==============================================================
# Utility Functions
# ==============================================================

def clean_java(code: str) -> str:
    code = code.strip()
    return re.sub(r"^```(?:java)?|```$", "", code).strip()

def detect_method_return_types(code: str):
    found = re.findall(r"public\s+([\w<>\[\]]+)\s+(\w+)\s*\(", code)
    return {name: rtype for rtype, name in found}

def extract_dependencies(code: str):
    fields = re.findall(r"(private|protected)\s+([\w<>\[\]]+)\s+(\w+)\s*(=|;)", code)
    return [(f[2], f[1]) for f in fields]  # return (name, type)

def is_service(code): return "@Service" in code or "@Component" in code
def is_repository(code): return "extends JpaRepository" in code or "extends CrudRepository" in code
def has_db(code): return any(x in code for x in ["EntityManager", "JdbcTemplate", "@Entity", "save(", "find"])
def should_skip(code): return any(ann in code for ann in ["@RestController", "@Controller", "@SpringBootApplication"])

def is_model_class(code):
    # Detect POJO/entity class
    return "@Entity" in code or (
            "class" in code and "get" in code and "set" in code
    )

# ==============================================================
# Project-wide class scanner
# ==============================================================

def scan_all_project_classes():
    base = pathlib.Path("src/main/java")
    class_map = {}  # simple class name -> FQN
    for path in base.rglob("*.java"):
        code = path.read_text(encoding="utf-8")
        pkg_match = re.search(r"package\s+([\w\.]+);", code)
        if not pkg_match:
            continue
        package = pkg_match.group(1)
        class_match = re.search(r"(public\s+)?(class|record|interface|enum)\s+(\w+)", code)
        if not class_match:
            continue
        class_name = class_match.group(3)
        class_map[class_name] = f"{package}.{class_name}"
    return class_map

PROJECT_CLASSES = scan_all_project_classes()

# ==============================================================
# Dynamic import detection
# ==============================================================

BASE_IMPORTS = {
    "@Test": "org.junit.jupiter.api.Test",
    "@BeforeEach": "org.junit.jupiter.api.BeforeEach",
    "assertEquals": "static org.junit.jupiter.api.Assertions.*",
    "assertTrue": "static org.junit.jupiter.api.Assertions.*",
    "assertFalse": "static org.junit.jupiter.api.Assertions.*",
    "@Mock": "org.mockito.Mock",
    "@InjectMocks": "org.mockito.InjectMocks",
    "Mockito.": "org.mockito.Mockito",
    "verify(": "org.mockito.Mockito",
}
MOCKITO_EXT = "org.mockito.junit.jupiter.MockitoExtension"
JAVA_BUILTINS = {
    "String", "Integer", "Long", "Short", "Double", "Float",
    "Boolean", "Character", "Object", "List", "Map", "Set",
    "Optional"
}
PRIMITIVES = {"byte","short","int","long","float","double","boolean","char"}

def auto_detect_imports(test_code: str, package: str, class_name: str):
    imports = set()
    imports.add(f"{package}.{class_name}")
    imports.add("java.util.*")
    imports.add("java.util.Optional")

    for token, imp in BASE_IMPORTS.items():
        if token in test_code:
            imports.add(imp)

    if "@ExtendWith(MockitoExtension.class)" in test_code:
        imports.add(MOCKITO_EXT)

    used_classes = set(re.findall(r"\b([A-Z][A-Za-z0-9_]*)\b", test_code))
    used_classes -= JAVA_BUILTINS
    used_classes -= {class_name, "Test"}

    for cls in used_classes:
        if cls in PROJECT_CLASSES:
            imports.add(PROJECT_CLASSES[cls])

    generic_matches = re.findall(r"[<,]\s*([A-Z][A-Za-z0-9_]*)\s*[>,]", test_code)
    for gen in generic_matches:
        if gen in PROJECT_CLASSES:
            imports.add(PROJECT_CLASSES[gen])

    return sorted(imports)

# ==============================================================
# Prompt builder
# ==============================================================

def build_prompt(class_name, package, java_code, use_mockito, dependencies, method_returns, model_class):
    method_list = "\n".join([f"- {name} -> returns {rtype}" for name, rtype in method_returns.items()])
    dep_list = ", ".join([name for name, _ in dependencies]) if dependencies else "None"

    instructions = [
        "Write a FULLY COMPILABLE JUnit 5 test class for the following Spring Boot class.",
        "STRICT RULES:",
        "1. Use ONLY the methods listed here:",
        method_list,
        f"2. Mockito usage allowed: {str(use_mockito).lower()}",
        "3. Instantiate POJO fields normally; mock only real object dependencies.",
        "4. For Optional<T>, always check isPresent() before calling get().",
        "5. For List/Iterable, always check iterator().hasNext().",
        "6. Generate positive test cases for all methods.",
    ]

    if model_class:
        instructions.append(
            "7. Do NOT create negative tests expecting exceptions (like NullPointerException). "
            "Test getters/setters only with valid values."
        )
    else:
        instructions.append(
            "7. Mock only service/repository/other object dependencies, not fields of primitive/wrapper types."
        )

    instructions.append(f"Dependencies to mock: {dep_list}")
    instructions.append("===== SOURCE =====")
    instructions.append(java_code)
    instructions.append(
        "Write only valid Java code (class body). Do not include package or import lines."
    )

    return "\n".join(instructions)

# ==============================================================
# Maven compile helper
# ==============================================================

def compile_with_maven(test_path: pathlib.Path):
    cmd = ["mvn", "-q", f"-Dtest={test_path.stem}", "test"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    out, err = proc.communicate()
    success = "BUILD SUCCESS" in out or "BUILD SUCCESS" in err
    return success, out + err

# ==============================================================
# Test generator
# ==============================================================

def generate_test(java_code, class_name, package):
    deps = extract_dependencies(java_code)
    methods = detect_method_return_types(java_code)
    service = is_service(java_code)
    repo = is_repository(java_code)
    db = has_db(java_code)
    model_class = is_model_class(java_code)

    # Skip repositories entirely
    if repo:
        print(f"⏩ Skipping repository interface: {class_name}")
        return None

    # Only mock dependencies that are not primitives/wrappers/String
    WRAPPERS = {"Byte","Short","Integer","Long","Float","Double","Boolean","Character","String"}
    mock_deps = [(name, typ) for name, typ in deps if typ not in WRAPPERS and typ not in PRIMITIVES]

    if model_class:
        # POJOs: no mocks, only positive tests
        use_mockito = False
        mock_deps = []
    else:
        use_mockito = bool(mock_deps or service or db)

    prompt = build_prompt(class_name, package, java_code, use_mockito, mock_deps, methods, model_class)

    test_dir = pathlib.Path("src/test/java") / pathlib.Path(*package.split("."))
    test_dir.mkdir(parents=True, exist_ok=True)
    test_file = test_dir / f"{class_name}Test.java"

    for attempt in range(5):
        print(f"🧪 Test attempt {attempt + 1}...")
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            temperature=0.1,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}]
        )
        raw_body = clean_java(response.choices[0].message.content)

        imports = auto_detect_imports(raw_body, package, class_name)
        import_block = "\n".join(f"import {i};" for i in imports)

        full_test_code = f"package {package};\n\n{import_block}\n\n{raw_body}"
        test_file.write_text(full_test_code, encoding="utf-8")

        ok, log = compile_with_maven(test_file)
        if ok:
            print("✔ Successfully compiled.")
            return full_test_code

        print("❌ Compilation failed, retrying...")
        prompt += f"\nFix compilation errors:\n{log}\n"

    raise Exception("Failed to generate a compilable test after 5 attempts.")

# ==============================================================
# Main processor
# ==============================================================

def process_files():
    for root, dirs, files in os.walk("src/main/java"):
        for file in files:
            if not file.endswith(".java"):
                continue
            full_path = os.path.join(root, file)
            code = open(full_path, "r", encoding="utf-8").read()

            if should_skip(code):
                print(f"⏩ Skipping: {file}")
                continue

            class_name = file[:-5]
            pkg_match = re.search(r"package\s+([\w\.]+);", code)
            package = pkg_match.group(1) if pkg_match else "default"

            print(f"\n🚀 Generating test for {class_name} ({package})")
            try:
                generate_test(code, class_name, package)
            except Exception as e:
                print(f"❌ Failed for {class_name}: {e}")

# ==============================================================
# Entry point
# ==============================================================

if __name__ == "__main__":
    print("🚀 Starting Dynamic Test Generator")
    process_files()
    print("🎉 Done!")
