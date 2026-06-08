import pypdf
import sys

pdf_path = "/Users/longhl/Downloads/贤者喜宴·噶玛岗仓史 (巴卧·祖拉陈瓦) (z-library.sk, 1lib.sk, z-lib.sk).pdf"

try:
    reader = pypdf.PdfReader(pdf_path)
    print(f"Total pages: {len(reader.pages)}")
    
    found_text = False
    for p_num in [0, 5, 10, 20, 50, 100]:
        if p_num < len(reader.pages):
            text = reader.pages[p_num].extract_text()
            print(f"--- Page {p_num} Sample ---")
            print(f"Length: {len(text)}")
            print(text[:200].strip())
            print("-" * 20)
            if text.strip():
                found_text = True
    
    if found_text:
        print("RESULT: Searchable")
    else:
        print("RESULT: Scanned/Image-based")
except Exception as e:
    print(f"Error: {e}")
