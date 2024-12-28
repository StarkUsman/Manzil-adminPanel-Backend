const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*', 
        methods: ['GET', 'POST'],      
        allowedHeaders: ['Authorization'], 
        credentials: true              
    }
});
app.use(express.json());
const port = 3000;

app.use(
    cors({
      origin: '*',
    })
  );
const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

app.get('/getUsers', async(req, res) => {
    try{
        const usersRef = db.collection('users');
        const usersSnapshot = await usersRef.get();
        if(usersSnapshot.empty){
            console.log('No users found.');
            return res.status(404).send('No users found.');
        }
        const users = await Promise.all(usersSnapshot.docs.map(async (doc) => {
            const userData = doc.data();
            return {
                id: doc.id,
                firstName: userData.first_name || '',
                lastName: userData.last_name || '',
                phoneNumber: userData.phone_number || '',
                email: userData.email || '',
                overallRating: userData.overallRating || 0,
                totalRatings: userData.totalRatings || 0,
                fraudCount: await getFraudCountsByUserID(doc.id) || 0,
                isBanned: userData.isBanned || false,
            };
        }));
        res.json(users);
    } catch(error){
        console.error('Method Name: getUsers()  |  Error getting users: ', error);
        res.status(500).send('Internal server error');
    }
});

app.get('/getUser/:id', async(req, res) => {
    try{
        const userId = req.params.id;
        const userRef = db.collection('users').doc(userId);
        const userSnapshot = await userRef.get();
        if(!userSnapshot.exists){
            console.log('User not found.');
            return res.status(404).send('User not found.');
        }
        const userData = userSnapshot.data();
        const user = {
            id: userSnapshot.id,
            firstName: userData.first_name || '',
            lastName: userData.last_name || '',
            phoneNumber: userData.phone_number || '',
            email: userData.email || '',
            overallRating: userData.overallRating || null,
            totalRatings: userData.totalRatings || 0
        };
        console.log('Method Name: getUserbyID()  |  User fetched against ID: ', user.firstName);
        res.json(user);
    } catch(error){
        console.error('Method Name: getUserbyID()  |  Error getting user: ', error);
        res.status(500).send('Internal server error');
    }
});

setInterval(async () => {
    const newEmergency = await newEmergencyHit();
    if (newEmergency) {
      io.emit('newEmergency', newEmergency);
      console.log('New emergency pushed to clients:', newEmergency);
    }
  }, 10000);
  
  io.on('connection', (socket) => {
    console.log('A client connected:', socket.id);
  
    // Handle client disconnection
    socket.on('disconnect', () => {
      console.log('A client disconnected:', socket.id);
    });
  });  

app.get('/getUserByName/:name', async (req, res) => {
    try {
      const name = req.params.name;
      const usersRef = db.collection('users');
      const usersSnapshot = await usersRef.get();
  
      if (usersSnapshot.empty) {
        console.log('No users found.');
        return res.status(404).send('No users found.');
      }
  
      const users = await Promise.all(usersSnapshot.docs.map(async (doc) => {
        const userData = doc.data();
        if (
          userData.first_name.toLowerCase().includes(name.toLowerCase()) || 
          userData.last_name.toLowerCase().includes(name.toLowerCase())
        ) {
          return {
            id: doc.id,
            firstName: userData.first_name || '',
            lastName: userData.last_name || '',
            phoneNumber: userData.phone_number || '',
            email: userData.email || '',
            overallRating: userData.overallRating || 0,
            totalRatings: userData.totalRatings || 0,
            fraudCount: await getFraudCountsByUserID(doc.id) || 0,
            isBanned: userData.isBanned || false,
          };
        }
        return null;
      }));
  
      const filteredUsers = users.filter(user => user !== null);
  
      console.log('Method Name: getUsersByName()  |  No of Docs: ', filteredUsers.length);
      res.json(filteredUsers);
  
    } catch (error) {
      console.error('Method Name: getUsersByName()  |  Error getting users: ', error);
      res.status(500).send('Internal server error');
    }
  });
  

app.put('/banUser/:id', async(req, res) => {
    try{
        const userId = req.params.id;
        const isBanned = req.body.isBanned===true ? true : false;
        const userRef = db.collection('users').doc(userId);
        const userSnapshot = await userRef.get();
        if(!userSnapshot.exists){
            console.log('User not found.');
            return res.status(404).send('User not found.');
        }
        await userRef.update({isBanned: isBanned});
        if(isBanned){
            console.log('Method Name: banUser()  |  User banned successfully');
            res.json({message: 'User banned successfully'});
        } else {
            console.log('Method Name: banUser()  |  User unbanned successfully');
            res.json({message: 'User unbanned successfully'});
        }
    } catch(error){
        console.error('Method Name: banUser()  |  Error banning user: ', error);
        res.status(500).send('Internal server error');
    }
});

app.get('/getRides', async(req, res) => {
    try{
        const ridesRef = db.collection('rides');
        const ridesSnapshot = await ridesRef.get();
        if(ridesSnapshot.empty){
            console.log('No rides found.');
            return res.status(404).send('No rides found.');
        }
        const rides = [];
        ridesSnapshot.forEach(doc => {
            const rideData = doc.data();
            rides.push({
                // id: doc.id,
                date: getDateTimeFromCreatedAt(rideData.createdAt)[0] || '',
                time: getDateTimeFromCreatedAt(rideData.createdAt)[1] || '',
                pickup: locationFromAddress(rideData.pickupLocation) || '',
                dropoff: locationFromAddress(rideData.destination) || '',
                driverName: rideData.driverName || '',
                passengerName: rideData.passengerName || '',
                status: rideData.status || null
            });
        });
        console.log('Method Name: getRides()  |  No of Docs: ', rides.length);
        res.json(rides);
    } catch(error){
        console.error('Method Name: getRides()  |  Error getting rides: ', error);
        res.status(500).send('Internal server error');
    }
});

//partial search by driver name
app.get('/getRidebyDriver/:name', async(req, res) => {
    try{
        const name = req.params.name;
        const ridesRef = db.collection('rides');
        const ridesSnapshot = await ridesRef.get();
        if(ridesSnapshot.empty){
            console.log('No rides found.');
            return res.status(404).send('No rides found.');
        }
        const rides = [];
        ridesSnapshot.forEach(doc => {
            const rideData = doc.data();
            if((rideData.driverName && rideData.driverName.toLowerCase().includes(name.toLowerCase())) || 
            (rideData.passengerName && rideData.passengerName.toLowerCase().includes(name.toLowerCase()))){
                rides.push({
                    date: getDateTimeFromCreatedAt(rideData.createdAt)[0] || '',
                    time: getDateTimeFromCreatedAt(rideData.createdAt)[1] || '',
                    pickup: locationFromAddress(rideData.pickupLocation) || '',
                    dropoff: locationFromAddress(rideData.destination) || '',
                    driverName: rideData.driverName || '',
                    passengerName: rideData.passengerName || '',
                    status: rideData.status || null
                });
            }
        });
        console.log('Method Name: getRidebyDriver()  |  No of Docs: ', rides.length);
        res.json(rides);
    } catch(error){
        console.error('Method Name: getRidebyDriver()  |  Error getting rides: ', error);
        res.status(500).send('Internal server error');
    }
});

app.get('/getEmergencies', async (req, res) => {
    try {
        const emergenciesRef = db.collection('emergencies');
        const emergenciesSnapshot = await emergenciesRef.get();

        if (emergenciesSnapshot.empty) {
            console.log('No emergencies found.');
            return res.status(404).send('No emergencies found.');
        }

        const emergencies = await Promise.all(emergenciesSnapshot.docs.map(async (doc) => {
            const emergencyData = doc.data();
            return {
                pushedBy: emergencyData.pushedBy || '',
                username: await getUsernameById(emergencyData.pushedBy) || '',
                reason: emergencyData.reason || 'No reason provided',
                rideId: emergencyData.rideId || null,
                rideData: await getRideDataById(emergencyData.rideId) || null,
                date: getDateTimeFromCreatedAt(emergencyData.timestamp)[0] || '',
                time: getDateTimeFromCreatedAt(emergencyData.timestamp)[1] || ''
            };
        }));

        console.log('Method Name: getEmergencies()  |  No of Docs: ', emergencies.length);
        res.json(emergencies);
    } catch (error) {
        console.error('Method Name: getEmergencies()  |  Error getting emergencies: ', error);
        res.status(500).send('Internal server error');
    }
});

// get emergencies by username or passenger name or driver name || partial search
app.get('/getEmergenciesByName/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const emergenciesRef = db.collection('emergencies');
        const emergenciesSnapshot = await emergenciesRef.get();
        if (emergenciesSnapshot.empty) {
            console.log('No emergencies found.');
            return res.status(404).send('No emergencies found.');
        }
        const emergencies = await Promise.all(emergenciesSnapshot.docs.map(async (doc) => {
            const emergencyData = doc.data();
            if (
                (emergencyData.pushedBy && (await getUsernameById(emergencyData.pushedBy)).toLowerCase().includes(name.toLowerCase())) ||
                (emergencyData.rideId && (await getRideDataById(emergencyData.rideId)).driverName.toLowerCase().includes(name.toLowerCase())) ||
                (emergencyData.rideId && (await getRideDataById(emergencyData.rideId)).passengerName.toLowerCase().includes(name.toLowerCase()))
            ) {
                return {
                    pushedBy: emergencyData.pushedBy || '',
                    username: await getUsernameById(emergencyData.pushedBy) || '',
                    reason: emergencyData.reason || 'No reason provided',
                    rideId: emergencyData.rideId || null,
                    rideData: await getRideDataById(emergencyData.rideId) || null,
                    date: getDateTimeFromCreatedAt(emergencyData.timestamp)[0] || '',
                    time: getDateTimeFromCreatedAt(emergencyData.timestamp)[1] || ''
                };
            }
            return null;
        }));
        const filteredEmergencies = emergencies.filter(emergency => emergency !== null);
        console.log('Method Name: getEmergenciesByName()  |  No of Docs: ', filteredEmergencies.length);
        res.json(filteredEmergencies);
    } catch (error) {
        console.error('Method Name: getEmergenciesByName()  |  Error getting emergencies: ', error);
        res.status(500).send('Internal server error');
    }
});


let emergencyCount = 0;
async function newEmergencyHit(){
    try{
        const emergenciesRef = db.collection('emergencies');
        const emergenciesSnapshot = await emergenciesRef.get();
        if(emergenciesSnapshot.empty){
            emergencyCount = 0;
            return
        }
        if(emergenciesSnapshot.size > emergencyCount){
            emergencyCount = emergenciesSnapshot.size;
            const emergencyData = emergenciesSnapshot.docs[emergenciesSnapshot.size - 1].data();
            const emergency = {
                pushedBy: emergencyData.pushedBy || '',
                username: await getUsernameById(emergencyData.pushedBy) || '',
                reason: emergencyData.reason || 'No reason provided',
                rideId: emergencyData.rideId || null,
                rideData: await getRideDataById(emergencyData.rideId) || null,
                date: getDateTimeFromCreatedAt(emergencyData.timestamp)[0] || '',
                time: getDateTimeFromCreatedAt(emergencyData.timestamp)[1] || ''
            };
            console.log('Method Name: newEmergencyHit()  |  New emergency hit');
            return emergency;
        }
    } catch(error){
        console.error('Method Name: newEmergencyHit()  |  Error getting new emergency: ', error);
        return null;
    }
}

app.put('/updateFareControls', async(req, res) => {
    try{
        const controlsID = 'AvSIjnKaS5vdhJmFZny2';
        const litersPerMeter = req.body.litersPerMeter ? req.body.litersPerMeter : null;
        const petrolRate = req.body.petrolRate || null;
        const vehicle = req.body.vehicle || null;

        const controlsRef = db.collection('controls').doc(controlsID);
        const controlsSnapshot = await controlsRef.get();
        if(!controlsSnapshot.exists){
            console.log('Controls not found.');
            return res.status(404).send('Controls not found.');
        }
        const controlsData = controlsSnapshot.data();
        const updatedControls = {
            litersPerMeter: litersPerMeter || controlsData.litersPerMeter,
            petrolRate: petrolRate || controlsData.petrolRate,
            vehicle: vehicle || controlsData.vehicle
        };
        await controlsRef.update(updatedControls);
        console.log('Method Name: updateFare()  |  Fare updated successfully');
        res.json(updatedControls);
    } catch(error){
        console.error('Method Name: updateFare()  |  Error updating fare: ', error);
        res.status(500).send('Internal server error');
    }
});

app.get('/getFareControls', async(req, res) => {
    try{
        const controlsID = 'AvSIjnKaS5vdhJmFZny2';
        const controlsRef = db.collection('controls').doc(controlsID);
        const controlsSnapshot = await controlsRef.get();
        if(!controlsSnapshot.exists){
            console.log('Controls not found.');
            return res.status(404).send('Controls not found.');
        }
        const controlsData = controlsSnapshot.data();
        const controls = {
            litersPerMeter: controlsData.litersPerMeter || null,
            petrolRate: controlsData.petrolRate || null,
            vehicle: controlsData.vehicle || null
        };
        console.log('Method Name: getControls()  |  Controls fetched successfully');
        res.json(controls);
    } catch(error){
        console.error('Method Name: getControls()  |  Error getting controls: ', error);
        res.status(500).send('Internal server error');
    }
});

app.get('/getFrauds', async(req, res) => {
    try{
        const fraudsRef = db.collection('frauds');
        const fraudsSnapshot = await fraudsRef.get();
        if(fraudsSnapshot.empty){
            console.log('No frauds found.');
            return res.status(404).send('No frauds found.');
        }

        const frauds = await Promise.all(fraudsSnapshot.docs.map(async (doc) => {
            const fraudData = doc.data();
            return {
                id: doc.id,
                date: getDateTimeFromCreatedAt(fraudData.timestamp)[0] || '',
                time: getDateTimeFromCreatedAt(fraudData.timestamp)[1] || '',
                fraudster: await getUsernameById(fraudData.fraudUserId) || '',
                driver: (await getRideDataById(fraudData.rideId)).driverName || '',
                reason: fraudData.reason || 'No reason provided',
            };
        }));
        console.log('Method Name: getFrauds()  |  No of Docs: ', frauds.length);
        res.json(frauds);
    } catch(error){
        console.error('Method Name: getFrauds()  |  Error getting frauds: ', error);
        res.status(500).send('Internal server error');
    }
});


// get frauds by fraudster or driver name || partial search
app.get('/getFraudsByName/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const fraudsRef = db.collection('frauds');
        const fraudsSnapshot = await fraudsRef.get();
        if (fraudsSnapshot.empty) {
            console.log('No frauds found.');
            return res.status(404).send('No frauds found.');
        }
        const frauds = await Promise.all(fraudsSnapshot.docs.map(async (doc) => {
            const fraudData = doc.data();
            if (
                (fraudData.fraudUserId && (await getUsernameById(fraudData.fraudUserId)).toLowerCase().includes(name.toLowerCase())) ||
                (fraudData.rideId && (await getRideDataById(fraudData.rideId)).driverName.toLowerCase().includes(name.toLowerCase()))
            ) {
                return {
                    id: doc.id,
                    date: getDateTimeFromCreatedAt(fraudData.timestamp)[0] || '',
                    time: getDateTimeFromCreatedAt(fraudData.timestamp)[1] || '',
                    fraudster: await getUsernameById(fraudData.fraudUserId) || '',
                    driver: (await getRideDataById(fraudData.rideId)).driverName || '',
                    reason: fraudData.reason || 'No reason provided',
                };
            }
            return null;
        }));
        const filteredFrauds = frauds.filter(fraud => fraud !== null);
        console.log('Method Name: getFraudsByName()  |  No of Docs: ', filteredFrauds.length);
        res.json(filteredFrauds);
    } catch (error) {
        console.error('Method Name: getFraudsByName()  |  Error getting frauds: ', error);
        res.status(500).send('Internal server error');
    }
});




function locationFromAddress(stringToSplit) {
    var addressBits = stringToSplit.split(',');
    return addressBits[0];
}

function getDateTimeFromCreatedAt(createdAt) {
    const milliseconds = createdAt._seconds * 1000 + createdAt._nanoseconds / 1e6;

    const dateObject = new Date(milliseconds);  

    const date = dateObject.toISOString().split("T")[0]; // "YYYY-MM-DD"
  
    let hours = dateObject.getHours();
    const minutes = dateObject.getMinutes().toString().padStart(2, "0");
    const seconds = dateObject.getSeconds().toString().padStart(2, "0");
    const period = hours >= 12 ? "PM" : "AM";
  
    hours = (hours % 12 || 12).toString().padStart(2, "0");
  
    const time = `${hours}:${minutes}:${seconds} ${period}`;
  
    return [date, time];
  }

async function getUsernameById(userId) {
    return db.collection('users').doc(userId).get().then((doc) => {
        if (doc.exists) {
            return doc.data().first_name;
        } else {
            return null;
        }
    }).catch((error) => {
        console.error("Error fetching user:", error);
        return null;
    });
}

async function getRideDataById(rideId) {
    return db.collection('rides').doc(rideId).get().then((doc) => {
        if (doc.exists) {
            const rideData = {
                date: getDateTimeFromCreatedAt(doc.data().createdAt)[0] || '',
                time: getDateTimeFromCreatedAt(doc.data().createdAt)[1] || '',
                pickup: locationFromAddress(doc.data().pickupLocation) || '',
                dropoff: locationFromAddress(doc.data().destination) || '',
                driverName: doc.data().driverName || '',
                passengerName: doc.data().passengerName || '',
                status: doc.data().status || null
            }
            return rideData;
        } else {
            console.log("No such document!");
        }
    }).catch((error) => {
        console.error("Error fetching ride:", error);
        return null;
    });
}

async function getFraudCountsByUserID(userId) {
    return db.collection('frauds').where('fraudUserId', '==', userId).get().then((querySnapshot) => {
        return querySnapshot.size;
    });
}

// app.listen(port, () => {
//   console.log(`Server is running on http://localhost:${port}`);
// });

server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});