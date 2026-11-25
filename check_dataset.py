
import zipfile
from pathlib import Path

files = [
    Path(r"C:\Users\ansu8\Downloads\ACNEClear.zip"),
    Path(r"C:\Users\ansu8\Downloads\DATASET_0.zip")
]

for path in files:
    print("\n" + "=" * 50)
    print("ARCHIVE:", path.name)

    if not path.exists():
        print("File not found")
        continue

    try:
        with zipfile.ZipFile(path, "r") as archive:
            names = archive.namelist()

            matches = [
                name for name in names
                if name.lower().endswith(
                    ("data.yaml", "dataset.yaml", "best.pt")
                )
            ]

            print("\nImportant files:")
            print("\n".join(matches[:30]) if matches else "No matching files")

            print("\nFirst 12 files:")
            for name in names[:12]:
                print(name)

    except Exception as error:
        print("Error:", error)
