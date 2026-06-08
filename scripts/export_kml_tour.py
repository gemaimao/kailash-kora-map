import json
import math

ROUTES_FILE = '/Users/longhl/代码学习/kailash-kora-map/data/routes.json'
POIS_FILE = '/Users/longhl/代码学习/kailash-kora-map/data/pois.json'
KML_OUT = '/Users/longhl/代码学习/kailash-kora-map/data/kailash_tour.kml'

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def calculate_bearing(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - (math.sin(lat1) * math.cos(lat2) * math.cos(dlon))
    initial_bearing = math.atan2(x, y)
    return (math.degrees(initial_bearing) + 360) % 360

def regenerate_flight_path():
    with open(ROUTES_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    main_route = data.get('main', [])
    FLIGHT_STEP = 350.0  # 350m sampling
    
    flight_path = []
    accumulated = 0.0
    last_pt = main_route[0]
    flight_path.append(last_pt)
    
    for pt in main_route[1:]:
        dist = haversine(last_pt[0], last_pt[1], pt[0], pt[1])
        accumulated += dist
        if accumulated >= FLIGHT_STEP:
            flight_path.append(pt)
            accumulated = 0.0
            last_pt = pt
            
    if flight_path[-1] != main_route[-1]:
        flight_path.append(main_route[-1])
        
    N = len(flight_path)
    raw_headings = []
    for i in range(N - 1):
        h = calculate_bearing(flight_path[i][0], flight_path[i][1], flight_path[i+1][0], flight_path[i+1][1])
        raw_headings.append(h)
    raw_headings.append(raw_headings[-1] if raw_headings else 0.0)
    
    smoothed_headings = []
    for i in range(N):
        start = max(0, i - 2)
        end = min(N, i + 3)
        sum_cos = 0.0
        sum_sin = 0.0
        for idx in range(start, end):
            rad = math.radians(raw_headings[idx])
            sum_cos += math.cos(rad)
            sum_sin += math.sin(rad)
        avg_rad = math.atan2(sum_sin, sum_cos)
        avg_deg = (math.degrees(avg_rad) + 360) % 360
        smoothed_headings.append(avg_deg)
        
    main_flight = []
    for i in range(N):
        main_flight.append({
            "lat": flight_path[i][0],
            "lng": flight_path[i][1],
            "heading": round(smoothed_headings[i], 2),
            "pitch": -32, # tilt 58 => 90 - 58 = 32, so pitch is -32
            "range": 530,
            "duration": 4
        })
        
    data['main_flight'] = main_flight
    with open(ROUTES_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        
    return main_flight

def export_kml():
    main_flight = regenerate_flight_path()
    
    with open(POIS_FILE, 'r', encoding='utf-8') as f:
        pois = json.load(f)

    kml = []
    kml.append('<?xml version="1.0" encoding="UTF-8"?>')
    kml.append('<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">')
    kml.append('<Document>')
    kml.append('  <name>冈仁波齐转山漫游</name>')
    kml.append('  <open>1</open>')
    
    # Write POIs
    kml.append('  <Folder><name>地标 POI</name>')
    for poi in pois:
        poi_id = poi.get("id", "").replace("msn_", "")
        # Use raw.githubusercontent.com to ensure proper CORS headers for Cesium WebGL
        icon_url = f"https://raw.githubusercontent.com/gemaimao/assets/main/kailashpic/{poi_id}.png"
        
        kml.append('    <Placemark>')
        # Name removed to avoid text overlap with UI burned-in icons
        
        kml.append('      <Style>')
        kml.append('        <IconStyle>')
        kml.append('          <scale>1.8</scale>') # Scale = 1.8
        kml.append('          <Icon>')
        kml.append(f'            <href>{icon_url}</href>')
        kml.append('          </Icon>')
        kml.append('        </IconStyle>')
        kml.append('        <LineStyle>')
        kml.append('          <color>99ffffff</color>')
        kml.append('          <width>1.5</width>')
        kml.append('        </LineStyle>')
        kml.append('      </Style>')
        
        # Altitude = 130
        kml.append('      <Point>')
        kml.append('        <extrude>1</extrude>')
        kml.append('        <altitudeMode>relativeToGround</altitudeMode>')
        kml.append(f'        <coordinates>{poi["lng"]},{poi["lat"]},130</coordinates>')
        kml.append('      </Point>')
        kml.append('    </Placemark>')
    kml.append('  </Folder>')
    
    # Write Tour
    kml.append('  <gx:Tour>')
    kml.append('    <name>▶️ 播放：神山巡礼</name>')
    kml.append('    <gx:Playlist>')
    
    for pt in main_flight:
        kml.append('      <gx:FlyTo>')
        kml.append(f'        <gx:duration>{pt["duration"]}</gx:duration>')
        kml.append('        <gx:flyToMode>smooth</gx:flyToMode>')
        kml.append('        <LookAt>')
        kml.append(f'          <longitude>{pt["lng"]}</longitude>')
        kml.append(f'          <latitude>{pt["lat"]}</latitude>')
        kml.append('          <altitude>0</altitude>')
        kml.append(f'          <heading>{pt["heading"]}</heading>')
        kml.append('          <tilt>58</tilt>') # Flight angle = 58
        kml.append(f'          <range>{pt["range"]}</range>')
        kml.append('          <altitudeMode>clampToGround</altitudeMode>')
        kml.append('        </LookAt>')
        kml.append('      </gx:FlyTo>')
        
    kml.append('    </gx:Playlist>')
    kml.append('  </gx:Tour>')
    
    kml.append('</Document>')
    kml.append('</kml>')
    
    with open(KML_OUT, 'w', encoding='utf-8') as f:
        f.write("\n".join(kml))
        
    print(f"Successfully generated {KML_OUT} with {len(pois)} POIs and {len(main_flight)} flight keyframes.")

if __name__ == '__main__':
    export_kml()
