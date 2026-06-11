const { DOMParser } = require('xmldom');
const fs = require('fs');
const kmlStr = fs.readFileSync('data/kailash_tour.kml', 'utf8');
const xmlDoc = new DOMParser().parseFromString(kmlStr, 'text/xml');
console.log('LineString elements:', xmlDoc.getElementsByTagName('LineString').length);
console.log('LineString NS elements:', xmlDoc.getElementsByTagNameNS('*', 'LineString').length);
console.log('Point elements:', xmlDoc.getElementsByTagName('Point').length);
console.log('Point NS elements:', xmlDoc.getElementsByTagNameNS('*', 'Point').length);
