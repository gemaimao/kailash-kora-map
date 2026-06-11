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

def export_kml():
    with open(ROUTES_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    main_flight = data.get('main_flight', [])
    
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
        # Map parameters from the new spec
        lng = pt.get("lng", 0.0)
        lat = pt.get("lat", 0.0)
        heading = pt.get("heading", 0.0)
        pitch = pt.get("pitch", -40.0)
        tilt = round(90.0 + pitch, 1) # tilt = 90 + pitch
        r = pt.get("relative_alt", pt.get("range", 500.0))
        duration = pt.get("duration", 2.5)

        kml.append('      <gx:FlyTo>')
        kml.append(f'        <gx:duration>{duration}</gx:duration>')
        kml.append('        <gx:flyToMode>smooth</gx:flyToMode>')
        kml.append('        <LookAt>')
        kml.append(f'          <longitude>{lng}</longitude>')
        kml.append(f'          <latitude>{lat}</latitude>')
        kml.append('          <altitude>0</altitude>')
        kml.append(f'          <heading>{heading}</heading>')
        kml.append(f'          <tilt>{tilt}</tilt>')
        kml.append(f'          <range>{r}</range>')
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
