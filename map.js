// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set access token
mapboxgl.accessToken =
  'pk.eyJ1IjoibG5yZG1sdCIsImEiOiJjbWh6YmMwOXowbGltMmtvbWhjYmtvd3c4In0.s3H5OwyvBJ9a829lVXYyyA';

// Initialize map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

const svg = d3.select('#map').select('svg');

// ----------------------------
// Helper: Get screen coords
// ----------------------------
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// ----------------------------
// Helper: Format time
// ----------------------------
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// ----------------------------
// Compute station traffic
// ----------------------------
function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    v => v.length,
    d => d.start_station_id
  );

  const arrivals = d3.rollup(
    trips,
    v => v.length,
    d => d.end_station_id
  );

  return stations.map(st => {
    const id = st.short_name;
    return {
      ...st,
      arrivals: arrivals.get(id) ?? 0,
      departures: departures.get(id) ?? 0,
      totalTraffic: (arrivals.get(id) ?? 0) + (departures.get(id) ?? 0)
    };
  });
}

// ------------------------
// Helper: Minutes since midnight
// ------------------------
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// ------------------------
// Filter trips by time
// ------------------------
function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) return trips;

  return trips.filter(trip => {
    const startM = minutesSinceMidnight(trip.started_at);
    const endM = minutesSinceMidnight(trip.ended_at);

    return (
      Math.abs(startM - timeFilter) <= 60 ||
      Math.abs(endM - timeFilter) <= 60
    );
  });
}

let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// --------------------------------------------------
// MAP LOAD EVENT
// --------------------------------------------------
map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });

  try {
    const jsonData = await d3.json(
      'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
    );

    // Parse trips as Date objects
    let trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      }
    );

    // Original station dataset (NEVER mutated)
    const stationsOriginal = jsonData.data.stations;

    // Compute initial traffic
    let stations = computeStationTraffic(
      stationsOriginal.map(o => ({ ...o })), 
      trips
    );

    // Radius scale
    const radiusScale = d3.scaleSqrt()
      .domain([0, d3.max(stations, d => d.totalTraffic)])
      .range([0, 25]);

    // ------------------------------
    // Draw initial circles
    // ------------------------------
    let circles = svg.selectAll("circle")
      .data(stations, d => d.short_name)
      .enter()
      .append("circle")
      .attr("r", d => radiusScale(d.totalTraffic))
      .attr("fill", "steelblue")
      .attr("stroke", "white")
      .attr("stroke-width", 1)
      .attr("opacity", 0.6)
      .each(function(d) {
        d3.select(this)
          .append("title")
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      })
    .style('--departure-ratio', (d) =>
    stationFlow(d.departures / d.totalTraffic),
  );

    // ------------------------------
    // Position update
    // ------------------------------
    function updatePositions() {
      circles
        .attr("cx", d => getCoords(d).cx)
        .attr("cy", d => getCoords(d).cy);
    }

    updatePositions();
    map.on("move", updatePositions);
    map.on("zoom", updatePositions);
    map.on("resize", updatePositions);

    // ------------------------------
    // Slider elements
    // ------------------------------
    const timeSlider = document.getElementById("time-slider");
    const selectedTime = document.getElementById("selected-time");
    const anyTimeLabel = document.getElementById("any-time");

    // ------------------------------
    // Update scatter plot
    // ------------------------------
    function updateScatterPlot(timeFilter) {
  const filteredTrips = filterTripsByTime(trips, timeFilter);
  const filteredStations = computeStationTraffic(jsonData.data.stations, filteredTrips);

  // ⭐ Fix domain AND range
  radiusScale
    .domain([0, d3.max(filteredStations, d => d.totalTraffic)])
    .range(timeFilter === -1 ? [0, 20] : [2, 25]);

  // Update circles
  circles = svg.selectAll("circle")
    .data(filteredStations, d => d.short_name)
    .join(
      enter => enter.append("circle")
        .attr("fill", "steelblue")
        .attr("stroke", "white")
        .attr("stroke-width", 1)
        .attr("opacity", 0.6),
      update => update,
      exit => exit.remove()
    )
    .attr("r", d => radiusScale(d.totalTraffic)).style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic),
    );

  updatePositions();
}

    // ------------------------------
    // Time slider behavior
    // ------------------------------
    function updateTimeDisplay() {
      const timeFilter = Number(timeSlider.value);

      if (timeFilter === -1) {
        selectedTime.textContent = "";
        anyTimeLabel.style.display = "block";
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = "none";
      }

      updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener("input", updateTimeDisplay);
    updateTimeDisplay();

  } catch (err) {
    console.error("Error:", err);
  }
});
