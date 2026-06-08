import pypdf
import os

pdf_path = "/Users/longhl/Downloads/贤者喜宴·噶玛岗仓史 (巴卧·祖拉陈瓦) (z-library.sk, 1lib.sk, z-lib.sk).pdf"
output_dir = "/Users/longhl/代码学习/kailash-kora-map/贤者喜宴_parts"

if not os.path.exists(output_dir):
    os.makedirs(output_dir)

try:
    reader = pypdf.PdfReader(pdf_path)
    total_pages = len(reader.pages)
    num_parts = 7
    
    # Calculate pages per part as evenly as possible
    # We want to distribute the remainder pages too
    base_pages = total_pages // num_parts
    remainder = total_pages % num_parts
    
    current_page = 0
    for i in range(num_parts):
        # Distribute remainder pages to the first few parts
        pages_in_this_part = base_pages + (1 if i < remainder else 0)
        start = current_page
        end = current_page + pages_in_this_part
        current_page = end
        
        writer = pypdf.PdfWriter()
        for page_num in range(start, end):
            writer.add_page(reader.pages[page_num])
        
        output_filename = os.path.join(output_dir, f"贤者喜宴{i+1}.pdf")
        with open(output_filename, "wb") as f:
            writer.write(f)
        print(f"Created {output_filename} (pages {start} to {end-1})")
        
except Exception as e:
    print(f"Error: {e}")
