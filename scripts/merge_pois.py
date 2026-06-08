import xml.etree.ElementTree as ET
import csv
import json
import os

# Paths
KML_PATH = '/Users/longhl/Desktop/神山图标.kml'
CSV_PATH = '/Users/longhl/Desktop/poi_content_template.csv'
OUT_JSON_PATH = '/Users/longhl/代码学习/kailash-kora-map/data/pois.json'

def parse_kml(kml_path):
    ns = {'kml': 'http://www.opengis.net/kml/2.2'}
    tree = ET.parse(kml_path)
    root = tree.getroot()
    
    kml_data = {}
    for placemark in root.findall('.//kml:Placemark', ns):
        name = placemark.find('kml:name', ns)
        name_text = name.text if name is not None else ""
        
        styleUrl = placemark.find('kml:styleUrl', ns)
        style_id = styleUrl.text.replace('#', '') if styleUrl is not None else ""
        
        # In KML, StyleMaps map msn_xxx to sn_xxx and sh_xxx
        # Usually styleUrl is #msn_xxx or #sn_xxx
        
        point = placemark.find('.//kml:Point/kml:coordinates', ns)
        if point is not None and point.text:
            coords = point.text.strip().split(',')
            lng = float(coords[0])
            lat = float(coords[1])
            kml_data[style_id] = {'lat': lat, 'lng': lng, 'name': name_text}
            
            # Also map standard names if style_id doesn't perfectly match
            if style_id.startswith('msn_'):
                sn_id = style_id.replace('msn_', 'sn_')
                kml_data[sn_id] = {'lat': lat, 'lng': lng, 'name': name_text}
                
    return kml_data

def parse_csv(csv_path):
    csv_data = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            csv_data.append(row)
    return csv_data

def merge_data():
    kml_coords = parse_kml(KML_PATH)
    csv_pois = parse_csv(CSV_PATH)
    
    # Existing pois.json to retain some fields if needed
    existing_pois = {}
    if os.path.exists(OUT_JSON_PATH):
        with open(OUT_JSON_PATH, 'r', encoding='utf-8') as f:
            old_data = json.load(f)
            for p in old_data:
                existing_pois[p.get('id')] = p
    
    merged_pois = []
    for row in csv_pois:
        style_id = row.get('IconStyle', '').strip()
        title = row.get('POI_Name_Or_Title', '').strip()
        bubble = row.get('Popup_HTML_Content', '').strip()
        
        poi = {
            "id": style_id,
            "name": title,
            "bubble": bubble,
        }
        
        # Get coordinates from KML
        if style_id in kml_coords:
            poi["lat"] = kml_coords[style_id]["lat"]
            poi["lng"] = kml_coords[style_id]["lng"]
        else:
            # Try finding by name in KML
            found = False
            for k_id, v in kml_coords.items():
                if v['name'] == title and v['name']:
                    poi["lat"] = v["lat"]
                    poi["lng"] = v["lng"]
                    found = True
                    break
            if not found:
                print(f"Warning: Coordinates not found for POI '{title}' (style: {style_id})")
                # Fallback to existing pois.json if available
                if style_id in existing_pois and 'lat' in existing_pois[style_id]:
                    poi["lat"] = existing_pois[style_id]["lat"]
                    poi["lng"] = existing_pois[style_id]["lng"]
        
        # Merge other fields from existing_pois if they match
        old_poi = existing_pois.get(style_id)
        if not old_poi:
            # Fallback by name
            for old in existing_pois.values():
                if old.get('name') == title:
                    old_poi = old
                    break
                    
        if old_poi:
            for k, v in old_poi.items():
                if k not in poi and k not in ['id', 'name', 'bubble', 'lat', 'lng']:
                    poi[k] = v
                    
        merged_pois.append(poi)
        
    with open(OUT_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(merged_pois, f, ensure_ascii=False, indent=2)
        
    print(f"Successfully generated {len(merged_pois)} POIs into {OUT_JSON_PATH}")

if __name__ == '__main__':
    merge_data()
