const alsong = require('alsong');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const config = require('./utils/Config')();
const Koa = require('koa');
const Router = require('koa-router');
const observable = require('./utils/Observable');

const { QApplication } = require("@nodegui/nodegui");


class Alspotify {
	constructor() {
		this.info = observable.init('api', {});
		this.lastUri = null;
		this.lastUpdate = -1;

		const app = new Koa();
		app.use(cors());
		app.use(bodyParser());

		const router = new Router();

		router.post('/', async (ctx) => {
			this.update(ctx.request.body);
		});

		router.get('/config', (ctx) => {

		});

		router.post('/config', (ctx) => {

		});

		router.post('/shutdown', (ctx) => {
			const qApp = QApplication.instance();
			qApp.quit();
		});

		app.use(router.routes()).use(router.allowedMethods());

		this.app = app;
		this.initialized = false;
	}

	init() {
		if(this.initialized)
			return;

		this.initialized = true;
		this.app.listen(1608, '127.0.0.1');
		this.info.$observe(() => {
			this.updateProgress();
		});
		setInterval(() => this.tick(), 50);
	}

	tick() {
		if(this.info.playing) {
			this.info.progress = Math.min(
				this.info.duration,
				this.info.progress + 50
			);
		}
	}

	async update(body) {
		if(!body.data || body.data.status !== 'playing') {
			this.info.playing = false;
			return;
		}

		if(
			typeof body.data.progress !== 'number' ||
			!isFinite(body.data.progress) ||
			body.data.progress < 0 ||
			body.data.progress > body.data.duration
		)
			return;

		body.data.progress = Math.max(0, Math.min(body.data.duration, body.data.progress));

		if(typeof body.data.title !== 'string' || !Array.isArray(body.data.artists)) {
			this.info.progress = body.data.progress;
			return;
		}

		if(typeof body.data.duration !== 'number' || !isFinite(body.data.duration) || body.data.duration < 0)
			return;

		this.info.$assign({
			playing: true,
			title: body.data.title,
			artist: body.data.artists.join(", "),
			progress: body.data.progress,
			duration: body.data.duration
		});

		if(body.data.cover_url && body.data.cover_url !== this.lastUri) {
			this.lastUri = body.data.cover_url;
			await this.updateLyric(body.data.lyrics);
		}
	}

	async updateLyric(spotifyLyric) {
		try {
			const lyric = await (
				alsong(this.info.artist, this.info.title, { playtime: Number(this.info.duration) })
					.then(lyricItems => {
						console.log(`Retrieved alsong info: ${lyricItems[0].artist} - ${lyricItems[0].title}`);
						return alsong.getLyricById(lyricItems[0].lyricId);
					})
					.then(lyricData => lyricData.lyric)
					.catch(err => {
						if (typeof spotifyLyric !== 'object') {
							return {};
						}
						
						return spotifyLyric;
					})
			);

			if(!lyric['0']) {
				lyric['0'] = [];
			}
			
			const timestamp = Object.keys(lyric).sort((v1, v2) => parseInt(v1) - parseInt(v2));
			this.info.lyric = {
				timestamp,
				lyric
			};
			this.lastUpdate = -1;

			console.log(`Retrieved lyric: ${this.info.artist} - ${this.info.title}`);
		} catch(e) {
			this.info.lyric = {
				timestamp: ['0'],
				lyric: {
					'0': []
				},
				current: []
			};
			this.lastUpdate = -1;
			console.error(`Error while retrieving lyric: ${e}`);
		}
	}

	updateProgress() {
		if(!this.info.lyric)
			return;

		let i = 0;
		for(; i < this.info.lyric.timestamp.length; i++) {
			if(this.info.lyric.timestamp[i + 1] > this.info.progress)
				break;
		}

		if(this.lastUpdate !== i) {
			const currentLyric = (this.info.lyric.lyric[this.info.lyric.timestamp[i]] || []).slice();
			while(config.lyric.count > currentLyric.length) {
				currentLyric.unshift('');
			}

			this.info.lyric.current = currentLyric;
			this.lastUpdate = i;
		}
	}
}

const api = new Alspotify();
module.exports = () => {
	api.init();

	return api.info;
};
module.exports.alspotify = api;
