import json
import sys
import os

def export_to_geojson(project_dir=None):
    # Determine base directory
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # Resolve project paths
    if project_dir:
        routes_file = os.path.join(base_dir, project_dir, 'data', 'routes.json')
        pois_file = os.path.join(base_dir, project_dir, 'data', 'pois.json')
        geojson_out = os.path.join(base_dir, project_dir, 'data', 'spatial_narrative.geojson')
    else:
        routes_file = os.path.join(base_dir, 'data', 'routes.json')
        pois_file = os.path.join(base_dir, 'data', 'pois.json')
        geojson_out = os.path.join(base_dir, 'data', 'spatial_narrative.geojson')
        
    print(f"Loading routes from: {routes_file}")
    print(f"Loading POIs from: {pois_file}")
    
    if not os.path.exists(routes_file):
        print(f"Error: Routes file not found at {routes_file}")
        return False
        
    # Load routes
    with open(routes_file, 'r', encoding='utf-8') as f:
        routes_data = json.load(f)
        
    # Support both new stacked structure and older flat structure
    main_flight = []
    if isinstance(routes_data, dict):
        main_flight = routes_data.get('main_flight', routes_data.get('main', []))
    elif isinstance(routes_data, list):
        main_flight = routes_data
        
    # Load POIs
    pois_data = []
    if os.path.exists(pois_file):
        with open(pois_file, 'r', encoding='utf-8') as f:
            pois_data = json.load(f)
    else:
        print("Warning: POIs file not found, exporting routes only.")
        
    geojson = {
        "type": "FeatureCollection",
        "name": "Spatial Narrative Track and POIs",
        "features": []
    }
    
    # 1. Export flight path as a 3D LineString
    if main_flight:
        coordinates = []
        for pt in main_flight:
            lng = pt.get('lng')
            lat = pt.get('lat')
            # Calculate absolute flight altitude: ground elevation + relative range height
            ground_alt = pt.get('elevation', 5000.0)
            relative_alt = pt.get('relative_alt', pt.get('range', 0.0))
            abs_alt = ground_alt + relative_alt
            
            if lng is not None and lat is not None:
                coordinates.append([lng, lat, abs_alt])
                
        if coordinates:
            line_feature = {
                "type": "Feature",
                "properties": {
                    "name": "Flight Path (导演飞行航迹)",
                    "type": "flight_path",
                    "stroke": "#f59e0b",
                    "stroke-width": 4,
                    "stroke-opacity": 0.8
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates
                }
            }
            geojson["features"].append(line_feature)
            print(f"Exported flight path with {len(coordinates)} waypoints.")
            
    # 2. Export POIs as Points
    for poi in pois_data:
        lng = poi.get('lng')
        lat = poi.get('lat')
        # Standard altitude is offset from ground or absolute
        alt = poi.get('height', 130.0) # default offset
        
        if lng is not None and lat is not None:
            point_feature = {
                "type": "Feature",
                "properties": {
                    "id": poi.get('id', ''),
                    "name": poi.get('name', '地标'),
                    "type": "poi",
                    "note": poi.get('note', ''),
                    "bubble": poi.get('bubble', ''),
                    "marker-color": "#ffcd55",
                    "marker-size": "medium"
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [lng, lat, alt]
                }
            }
            geojson["features"].append(point_feature)
            
    print(f"Exported {len(pois_data)} POIs.")
    
    # Write GeoJSON out
    os.makedirs(os.path.dirname(geojson_out), exist_ok=True)
    with open(geojson_out, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)
        
    print(f"SUCCESS: GeoJSON exported successfully to {geojson_out}")
    return True

if __name__ == '__main__':
    project = sys.argv[1] if len(sys.argv) > 1 else None
    export_to_geojson(project)
