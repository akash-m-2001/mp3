// Get the packages we need
var express = require('express'),
    router = express.Router(),
    mongoose = require('mongoose'),
    bodyParser = require('body-parser');

// ✅ Read .env file first
require('dotenv').config();

// Create our Express application
var app = express();

// Use environment defined port or 3000
var port = process.env.PORT || 3000;
console.log('Connecting to MongoDB with URI:', process.env.MONGODB_URI);
// ✅ Connect to MongoDB Atlas (remove the old commented-out line)
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// ✅ Optional — log connection success or errors
mongoose.connection.on('connected', () => {
    console.log('✅ MongoDB connected successfully');
});
mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err);
});

// Allow CORS so that backend and frontend could be put on different servers
var allowCrossDomain = function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    next();
};
app.use(allowCrossDomain);

// Use the body-parser package in our application
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

// Use routes as a module (see index.js)
require('./routes')(app, router);

// Start the server
app.listen(port, () => {
    console.log('🚀 Server running on port ' + port);
});
