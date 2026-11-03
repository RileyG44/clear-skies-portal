"""The markup pane's exact-size parser, run from its own source with swift.

MarkupSizeRow.parse reads a typed number of feet in the phone's locale and
refuses anything ambiguous. The cases cover point- and comma-decimal locales
and space grouping."""
import pathlib
import shutil
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / "Sources/Shell/Sheet/MarkupPanel.swift"
CASES = [
    ("2.5", "en_US", "2.5"), ("1,234.5", "en_US", "1234.5"), ("1,000", "en_US", "1000.0"), ("2,5", "en_US", "nil"),
    ("12 ft", "en_US", "12.0"), ("-3", "en_US", "-3.0"), ("1 2", "en_US", "nil"), ("abc", "en_US", "nil"),
    ("2,5", "de_DE", "2.5"), ("1.234,5", "de_DE", "1234.5"), ("2.5", "de_DE", "2.5"), ("1.234", "de_DE", "nil"),
    ("1.2345,6", "de_DE", "nil"), ("0,25 feet", "de_DE", "0.25"),
    ("12 345,6", "fr_FR", "12345.6"), ("12\u202f345,6", "fr_FR", "12345.6"), ("1 2", "fr_FR", "nil"),
]


def swift_literal(text):
    """A Swift string literal; anything beyond printable ASCII as \\u{...}."""
    return '"' + "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else f"\\u{{{ord(c):x}}}" for c in text) + '"'


def parser_source():
    text = SOURCE.read_text()
    start = text.index("    static func parse(")
    start = text.rindex("    ///", 0, start)
    end = text.index("\n    }\n", text.index("    static func parse(")) + len("\n    }\n")
    return text[start:end]


@unittest.skipUnless(shutil.which("swift"), "needs the Swift toolchain")
class MarkupParseTests(unittest.TestCase):
    def test_locale_numbers(self):
        checks = "\n".join(f'print(P.parse({swift_literal(text)}, locale: Locale(identifier: "{locale}")).map {{ String($0) }} ?? "nil")'
                           for text, locale, _ in CASES)
        program = f"import Foundation\nenum P {{\n{parser_source()}\n}}\n{checks}\n"
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "parse.swift"
            path.write_text(program)
            result = subprocess.run(["swift", str(path)], capture_output=True, text=True, timeout=300)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.split(), [expected for _, _, expected in CASES])


if __name__ == "__main__":
    unittest.main()
