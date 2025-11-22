ThereYouG🌍

A lightweight, multilingual, map-based web application that helps tourists discover nearby attractions, view safety services, get fair price estimates, check weather, plan routes, and receive personalized recommendations based on their interests.

🚀 Overview

Smart Tourism provides an all-in-one digital toolkit for travelers — bringing together local discovery, safety information, route planning, fair prices, weather, multilingual UI, and an AI-powered recommendation system.
It works smoothly on modern browsers, supports offline elements (cached tiles, PDF export), and integrates multiple free public APIs.

🎯 Key Features
🗺️ Interactive Map (Leaflet)

Real-time location detection

Nearby attractions & POIs

Marker clustering + heat layers

Offline-friendly tile caching

🛟 Safety Awareness

Shows nearby police stations, hospitals, fire stations, hotels

Helps users take informed decisions

Uses Overpass/OSM for data

🔍 Tourist Places Discovery

Fetches places via OSM tags

Wikipedia integration for short summaries

Quick details & categories

🤖 Personalized Recommendation System

Smart ranking based on:

User interests (history, food, nature, architecture...)

Distance from user

Nearby safety services

Popularity (Wiki views / cluster density)

Freshness (opening availability)

🧭 Route Planner

Turn-by-turn routing

Powered by Leaflet Routing Machine

Walking/driving compatibility

💰 Fair Price Guide

Helps avoid scams

Estimates prices for common services/items

Location-contextual logic

🌦️ Weather Forecast

3-day weather from Open-Meteo

🗣️ Multilingual Support

Built-in support for:

English

Hindi

Tamil
Using client-side i18n JSON files.

📄 PDF Export / Offline Sharing

Download map snapshots

Generate PDF reports (html2canvas + jsPDF)

Share routes & POIs easily

🔐 Optional Authentication (JWT)

Lightweight login

Token verification

Personalized dashboard

🧱 Tech Stack
Frontend

HTML, CSS, JavaScript

Leaflet + MarkerCluster + Heatmap

Leaflet Routing Machine

Bootstrap

html2canvas

jsPDF

Backend (Optional Module)

Node.js + Express

JWT Authentication

User profile storage (MySQL / Mongo / JSON / etc.)

APIs Used

OpenStreetMap / Overpass API – POI Discovery

Nominatim – Geocoding

Open-Meteo – Weather

Wikipedia REST API – Summaries

📂 Folder Structure
SmartTourism/
│
├── index.html                 # Main map + i18n initialization
├── style.css                  # Global theme & styles
├── script.js                  # Map logic, POI loading, UI handlers
│
├── tour_guide/
│   ├── tour_guide.html        # Recommendations UI
│   └── tour_guide.js
│
├── place_details/
│   ├── place_details.html     # Routing + PDF export
│   └── place_details.js
│
├── fair_details/
│   ├── fair_details.html      # Price guide
│   └── fair_details.js
│
├── user_dashboard/
│   ├── dashboard.html
│   └── dashboard.js
│
├── assets/                    # Images, icons, etc.
│
├── i18n/                      # Multilingual files
│   ├── en.json
│   ├── hi.json
│   └── ta.json
│
└── backend/ (optional)
    ├── server.js
    ├── routes/
    └── controllers/

🔧 Installation & Setup
1. Clone the Repository
git clone https://github.com/your-username/smart-tourism.git
cd smart-tourism

2. Run Locally (Static Mode)

Any static server works:

npx http-server . -p 8080


or:

python3 -m http.server 8080

3. Run with Backend (Optional)

Install dependencies:

cd backend
npm install
npm start


Update API base URLs inside the frontend if using backend mode.

🧠 Personalized Recommendation System (How It Works)

Each place is scored using:

Final Score =
  0.45 * InterestMatch
+ 0.25 * DistanceScore
+ 0.15 * SafetyScore
+ 0.10 * PopularityScore
+ 0.05 * Freshness


Then sorted → top N recommendations shown to the user.

🛡️ Privacy & Security

No personal data is collected unless user logs in.

All preferences (interests, language) stored locally by default.

Token stored in HTTPOnly cookies for security.

This app does not provide emergency response — only guidance.

🧪 Testing & QA

Manual testing for geolocation, routing, language switch, POI results

Check Overpass rate limits

Validate PDF export on multiple devices

(Optional) Jest unit tests for scoring & utilities

🚧 Limitations

Overpass API rate limits may affect high-traffic areas

OSM data can vary region to region

No advanced ML personalization (yet)

No real-time emergency alerts

🌟 Future Enhancements

Vector embeddings for semantic POI matching

Offline map downloads

Admin portal for local tourism authorities

Crowdsourced reviews

Advanced SOS features

ML-based safety predictions

🤝 Contributing

Contributions are welcome!
Feel free to open an issue, create a pull request, or suggest a new module.

📜 License

MIT License

💬 Customer Support Chatbot

Smart Tourism includes an optional AI-powered support assistant to help tourists understand features, routes, recommendations, and safety information.