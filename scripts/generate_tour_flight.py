import json
import math
import os

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

ROUTES_FILE = '/Users/longhl/代码学习/kailash-kora-map/data/routes.json'

def generate():
    with open(ROUTES_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    main_route = data.get('main', [])
    if not main_route:
        print("No 'main' route found.")
        return
        
    FLIGHT_STEP = 1000.0  # 1000 meters downsampling for a normal speed 2-3 minute tour
    
    flight_path = []
    points_in_segment = [0] # index 0 has no incoming segment
    accumulated = 0.0
    last_pt = main_route[0]
    flight_path.append(last_pt)
    current_segment_pts = 0
    
    for pt in main_route[1:]:
        dist = haversine(last_pt[1], last_pt[0], pt[1], pt[0])
        accumulated += dist
        current_segment_pts += 1
        last_pt = pt  # Always update last_pt to measure path length correctly
        
        if accumulated >= FLIGHT_STEP:
            flight_path.append(pt)
            points_in_segment.append(current_segment_pts)
            accumulated = 0.0
            current_segment_pts = 0
            
    if flight_path[-1] != main_route[-1]:
        flight_path.append(main_route[-1])
        points_in_segment.append(current_segment_pts)
        
    N = len(flight_path)
    
    raw_headings = []
    for i in range(N - 1):
        h = calculate_bearing(flight_path[i][1], flight_path[i][0], flight_path[i+1][1], flight_path[i+1][0])
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
        # 动态计算飞行速度：点位密集则慢（时间长），点位稀疏则快（时间短）
        # 平均 1000 米可能有 250 个点。
        pts = points_in_segment[i] if i < len(points_in_segment) else 250
        dur = max(1.5, min(5.0, pts / 60.0)) # 限制在 1.5秒 到 5.0秒 之间
        if i == 0: dur = 4.0 # 初始起飞时间
        
        main_flight.append({
            "lat": flight_path[i][1],
            "lng": flight_path[i][0],
            "heading": round(smoothed_headings[i], 2),
            "pitch": -40,
            "range": 500,
            "duration": round(dur, 1)
        })
        
    data['main_flight'] = main_flight
    
    with open(ROUTES_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        
    print(f"Successfully generated {len(main_flight)} flight keyframes into routes.json")

if __name__ == '__main__':
    generate()
