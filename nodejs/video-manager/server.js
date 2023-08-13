import KcAdminClient from '@keycloak/keycloak-admin-client';
import bodyParser from 'body-parser';
import * as dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';
import fs from 'fs';
import Keycloak from 'keycloak-connect';
import { MongoClient, ObjectId } from 'mongodb';
import multer from 'multer';
import path from 'path';

import logger from './logUtil.js';
import { getVaultSecrets, getVaultDBCredentials } from './vault.js';

// read env vars
dotenv.config();

// ottiene i segreti da Vault
console.log('Attendi che Vault sia online e pronto a rispondere alle richieste HTTP');
const secrets = await getVaultSecrets(process.env.VAULT_ENDPOINT, process.env.ROLE_ID, process.env.SECRET_ID);

// crea un nuovo DB client temporaneo
var client = await createTemporaryClient();

// set global vars
const kcBaseUrl = secrets.shared.KC_BASEURL;
const kcRealm = secrets.shared.KC_REALM;
const kcClientBaseId = secrets.shared.KC_CLIENT_BASE_ID;
const kcClientAdminId = secrets.personal.KC_CLIENT_ADMIN_ID;
const kcClientAdminPassword = secrets.personal.KC_CLIENT_ADMIN_PASSWORD;
const sessionSecret = secrets.personal.SESSION_SECRET;

// init express
const app = express();

// Define the CSP header middleware function
const cspHeaderMiddleware = function(req, res, next) {
  res.setHeader('Content-Security-Policy', "default-src 'self' https://auth.uninastream.ddnsfree.com; style-src 'self' https://cdnjs.cloudflare.com/; script-src 'self' https://cdnjs.cloudflare.com/; img-src 'self' data:");
  res.setHeader('X-Frame-Options', "DENY");
  res.setHeader('X-Content-Type-Options', "nosniff");
  next();
}

// Use the middleware function in your application
app.use(cspHeaderMiddleware);

// Define view engine
app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.use('/media/static', express.static('static'));
app.use('/media/previews', express.static('media/previews'));

// config Keycloak
const memoryStore = new session.MemoryStore();
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    store: memoryStore
  })
);
const kcConfig = {
  "realm": kcRealm,
  "auth-server-url": kcBaseUrl,
  "ssl-required": "external",
  "resource": kcClientBaseId,
  "public-client": true,
  "confidential-port": 0
};
const keycloak = new Keycloak({ store: memoryStore }, kcConfig);
app.use(
  keycloak.middleware({
    logout: '/logout',
    admin: '/',
    protected: '/protected/resource'
  })
);

// config multer middleware per l'upload di previews and videos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let folder = '';
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
      folder = './media/previews/';
    } else if (file.mimetype === 'video/mp4') {
      folder = './media/videos/';
    }
    cb(null, folder);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

// protect video file
app.get('/media/videos/:id.mp4', keycloak.protect(), (req, res) => {
  res.locals.content = req.kauth.grant.access_token.content || {};
  res.locals.session = req.session || {};
  // check dei permessi di visualizzazione
  if ((req.kauth.grant.access_token.content.realm_access.roles.includes('video-viewer-' + req.params.id)) == false) {
    return res.render('pages/error.ejs', { error: 'Non si dispongono dei permessi necessari' });
  }
  const videoPath = `./media/videos/${req.params.id}.mp4`;
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;
  // split del video in frammenti inviati sequenzialmente al browser
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(videoPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(videoPath).pipe(res);
  };
});

// get aggiungi video
app.get('/media/add-video', keycloak.protect('realm:video-manager'), async function (req, res) {
  logger.info("Aggiungi Video page visited");
  res.locals.content = req.kauth.grant.access_token.content || {};
  res.locals.session = req.session || {};
  res.render('pages/add-video');
});

// submit aggiungi video
app.post('/media/add-video', keycloak.protect('realm:video-manager'), upload.fields([
  { name: 'preview', maxCount: 1 },
  { name: 'video', maxCount: 1 }
]), async function (req, res) {
  logger.info("Aggiungi Video page submitted");
  res.locals.content = req.kauth.grant.access_token.content || {};
  res.locals.session = req.session || {};
  const abbonamento = (req.body.abbonamento == 'on');
  const video = {
    titolo: req.body.titolo,
    descrizione: req.body.descrizione,
    previewPath: req.files['preview'][0],
    videoPath: req.files['video'][0],
    abbonamento: abbonamento,
  };
  const videoId = await createVideoDB(video);
  await createRole(videoId, video.titolo, abbonamento);
  res.redirect('/media/add-video');
});

// get modifica video
app.get('/media/edit-video', keycloak.protect('realm:video-manager'), async function (req, res) {
  logger.info("Modifica Video page visited");
  res.locals.content = req.kauth.grant.access_token.content || {};
  res.locals.session = req.session || {};
  var videos = [];
  try {
    // Connessione a MongoDB e query
    await client.connect();
    let db = client.db("unina");
    const MyCollection = db.collection('video');
    videos = await MyCollection.find().sort({ titolo: 1 }).toArray();
    await client.close();
  } catch (error) {
    logger.error("Client error on database connection! specific error: "+error);
    console.error(error);
  }
  // Check se l'utente ha selezionato un video
  var selectedVideo = undefined;
  if (req.query.id){
    selectedVideo = videos.find(element => element._id == req.query.id );
  }
  res.render('pages/edit-video', { videos: videos, selectedVideo: selectedVideo });
});

// submit aggiorna video
app.post('/media/update-video', keycloak.protect('realm:video-manager'), async function (req, res) {
  logger.info("Update Video page submitted");
  res.locals.content = req.kauth.grant.access_token.content || {};
  res.locals.session = req.session || {};
  const video_id = req.body.video_id;
  const abbonamentoClient = req.body.abbonamento;
  try {
    // Connessione a MongoDB e query
    await client.connect();
    let db = client.db("unina");
    const MyCollection = db.collection('video');
    let myquery = { _id: new ObjectId(video_id) };
    // cerca video su MongoDB
    const video = await MyCollection.findOne(myquery);
    // se il flag abbonamento non è stato modificato
    if (video.abbonamento == abbonamentoClient){
      // non fare nulla
      logger.info("Nessuna modifica applicata!");
      res.status(200).send("Nessuna modifica applicata!");
    } else {
      // aggiorna video su MongoDB e composite_role su Keycloak
      await MyCollection.updateOne(video, { $set: { abbonamento: abbonamentoClient }});
      await updateCompositeRole(video_id, abbonamentoClient);
      await client.close();
      logger.info(`Video ${video_id} updated successfully!`);
      res.status(200).send(`Video ${video_id} updated successfully!`);
    }
  } catch (error) {
    logger.error("Client error on database connection! specific error: "+error);
    console.error(error);
    res.status(500).send("Internal Server Error!");
  }
});

// submit elimina video
app.post('/media/delete-video', keycloak.protect('realm:video-manager'), async function (req, res) {
  logger.info("Delete Video page submitted");
  res.locals.content = req.kauth.grant.access_token.content || {};
  res.locals.session = req.session || {};
  const video_id = req.body.video_id;
  try {
    // Connessione a MongoDB e query
    await client.connect();
    let db = client.db("unina");
    const MyCollection = db.collection('video');
    let myquery = { _id: new ObjectId(video_id) };
    const video = await MyCollection.findOneAndDelete(myquery);
    // se il video è stato trovato e eliminato su MongoDB
    if (video.ok == '1') {
      // elimina dal file system
      fs.unlink(video.value.previewPath, (err) => {
        if (err) throw err;
      });
      fs.unlink(video.value.videoPath, (err) => {
        if (err) throw err;
        console.log(`Video ${video_id} deleted successfully!`);
      });
      // elimina ruolo su keycloak
      await deleteRole(video_id);
    }
    await client.close();
    logger.info(`Video ${video_id} deleted successfully!`);
    res.status(200).send(`Video ${video_id} deleted successfully!`);
  } catch (error) {
    logger.error("Client error on database connection! specific error: "+error);
    console.error(error);
    res.status(500).send("Internal Server Error!");
  }
});

// crea istanza su MongoDB e rinonima preview e video
async function createVideoDB(video) {
  try {
    // Connessione a MongoDB
    await client.connect();
    let db = client.db("unina");
    const MyCollection = db.collection('video');
    // Insert Video query => return id in <ret-obj>.insertedId
    const insert = await MyCollection.insertOne(video);
    // Rename files in file system
    const newPreviewPath = video.previewPath.destination + insert.insertedId + path.extname(video.previewPath.originalname);
    const newVideoPath = video.videoPath.destination + insert.insertedId + path.extname(video.videoPath.originalname);
    fs.rename(video.previewPath.path, newPreviewPath, function (err) {
      if (err) throw err;
    });
    fs.rename(video.videoPath.path, newVideoPath, function (err) {
      if (err) throw err;
    });
    // Update Video query
    const filter = { _id: new ObjectId(insert.insertedId) };
    video.previewPath = newPreviewPath;
    video.videoPath = newVideoPath;
    await MyCollection.updateOne(filter, { $set: video });
    await client.close();
    logger.info(`Video ${insert.insertedId} created successfully!`);
    console.log(`Video ${insert.insertedId} created successfully!`);
    return insert.insertedId;
  }
  catch (error) {
    logger.error("Client error on database connection! specific error: "+error);
    console.error('Error creating video:', error);
    return -1;
  }
}

// crea ruolo video-viewer-<id> su Keycloak
async function createRole(videoId, titoloVideo, abbonamento) {
  try {
    // Connect keycloak admin client
    const kcAdminClient = new KcAdminClient({
      baseUrl: kcBaseUrl,
      realmName: kcRealm,
    });
    await kcAdminClient.auth({
      grantType: 'client_credentials',
      clientId: kcClientAdminId,
      clientSecret: kcClientAdminPassword,
    });
    const newRole = {
      name: `video-viewer-${videoId}`,
      description: `ruolo per video "${titoloVideo}"`,
      clientRole: false,
      composite: false,
    };
    // Crea un nuovo ruolo nel realm
    await kcAdminClient.roles.create(newRole);
    // se l'abbonamento è attivo, aggiungi newRole a video-viewer
    if (abbonamento) {
      const videoViewer = await kcAdminClient.roles.findOneByName({ name: "video-viewer" });
      const createdRole = await kcAdminClient.roles.findOneByName({ name: newRole.name });
      await kcAdminClient.roles.createComposite({ roleId: videoViewer.id }, [createdRole]);
    }
    logger.info(`Role ${newRole.name} created successfully!`);
    console.log(`Role ${newRole.name} created successfully!`);
  } catch (error) {
    logger.fatal('Error creating role:', error);
    console.error('Error creating role:', error);
  }
}

// elimina ruolo video-viewer-<id> su Keycloak 
async function deleteRole(videoId) {
  try {
    // Connect keycloak admin client
    const kcAdminClient = new KcAdminClient({
      baseUrl: kcBaseUrl,
      realmName: kcRealm,
    });
    await kcAdminClient.auth({
      grantType: 'client_credentials',
      clientId: kcClientAdminId,
      clientSecret: kcClientAdminPassword,
    });
    // Elimina il ruolo dal realm
    const nameRole = `video-viewer-${videoId}`;
    await kcAdminClient.roles.delByName({ name: nameRole });
    
    logger.info(`Role ${nameRole} deleted successfully!`);
    console.log(`Role ${nameRole} deleted successfully!`);
  } catch (error) {
    logger.fatal('Error deleting role:', error);
    console.error('Error deleting role:', error);
  }
}

// aggiorna composite_role tra video-viewer-<id> e video-viewer
async function updateCompositeRole(videoId, abbonamento) {
  try {
    // Connect keycloak admin client
    const kcAdminClient = new KcAdminClient({
      baseUrl: kcBaseUrl,
      realmName: kcRealm,
    });
    await kcAdminClient.auth({
      grantType: 'client_credentials',
      clientId: kcClientAdminId,
      clientSecret: kcClientAdminPassword,
    });
    // Cerca nel realm i ruoli associati all'abbonamento e al video
    const nameRole = `video-viewer-${videoId}`;
    const videoViewer = await kcAdminClient.roles.findOneByName({ name: "video-viewer" });
    const selectedRole = await kcAdminClient.roles.findOneByName({ name: nameRole });
    if (abbonamento) {
      await kcAdminClient.roles.createComposite({ roleId: videoViewer.id }, [ selectedRole ]);
    } else {
      await kcAdminClient.roles.delCompositeRoles({ id: videoViewer.id }, [ selectedRole ]);
    }
    logger.info(`Composite role ${nameRole} update successfully!`);
    console.log(`Composite role ${nameRole} update successfully!`);
  } catch (error) {
    logger.error('Error updating composite role:', error);
    console.error('Error updating composite role:', error);
  }
}

app.all('*', async function (req, res) {
  logger.warn("Wrong path requested: "+req.url);
  console.log(req.url);
  res.locals.session = req.session;
  res.locals.content = req.session['keycloak-token'] ? req.kauth.grant.access_token.content : {};
  res.render('pages/404');
})

async function createTemporaryClient(){
  console.log("creating new DB temporary client...");
  const db = await getVaultDBCredentials(process.env.VAULT_ENDPOINT, process.env.ROLE_ID, process.env.SECRET_ID);
  const mongoUrl ='mongodb+srv://'+db.username+':'+db.password+'@cluster0.dj6bwc7.mongodb.net/?retryWrites=true&w=majority';
  const client = new MongoClient(mongoUrl);
  return client;
}

const taskInterval=60*60*1000; // every hour
setInterval(async () => {
  var temp_client = await createTemporaryClient();
  await new Promise((resolve) => setTimeout(resolve, 60000));
  client = temp_client;
}, taskInterval);

app.listen(5000);
console.log('Server is listening on port 5000');
