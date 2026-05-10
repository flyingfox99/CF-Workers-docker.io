// _worker.js

// 默认上游 Docker 镜像仓库
const DEFAULT_HUB_HOST = 'registry-1.docker.io';
// 默认伪装 HTML（防止 Cloudflare 识别为开放代理封禁）
const NGINX_HTML = `<!DOCTYPE html><html><head><title>Welcome to nginx!</title><style>body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }</style></head><body><h1>Welcome to nginx!</h1><p>If you see this page, the nginx web server is successfully installed and working.</p><p><em>Thank you for using nginx.</em></p></body></html>`;

// 路由表：根据域名前缀分配不同上游
const ROUTES = {
	"quay": "quay.io",
	"gcr": "gcr.io",
	"k8s-gcr": "k8s.gcr.io",
	"k8s": "registry.k8s.io",
	"ghcr": "ghcr.io",
	"cloudsmith": "docker.cloudsmith.io",
	"nvcr": "nvcr.io"
};

export default {
	async fetch(request, env, ctx) {
		// 1. 初始化每个请求的独立状态 (绝不使用全局变量，防止并发泄漏)
		const url = new URL(request.url);
		const workers_url = `${url.protocol}//${url.host}`;
		const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();

		// 2. 反爬虫与主动探测防御机制 (Cloudflare 防滥用要求)
		let blockBots = ['netcraft', 'baiduspider', 'yandex'];
		if (env.UA) {
			// 将环境变量中配置的UA转为数组
			const customUAs = env.UA.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
			blockBots.push(...customUAs);
		}
		// 拦截爬虫或直接访问首页的请求，返回伪装页
		if (blockBots.some(bot => userAgent.includes(bot)) || url.pathname === '/') {
			return new Response(NGINX_HTML, {
				status: 200,
				headers: { 'Content-Type': 'text/html; charset=utf-8' }
			});
		}

		// 3. 确定目标上游仓库
		const ns = url.searchParams.get('ns');
		const hostTop = url.hostname.split('.')[0];
		let hub_host = DEFAULT_HUB_HOST;

		if (ns && ns !== 'docker.io') {
			hub_host = ns;
		} else if (ROUTES[hostTop]) {
			hub_host = ROUTES[hostTop];
		}

		// 4. 代理 Docker Auth 认证请求
		// 当请求 token 时，直接透传给官方认证服务器
		if (url.pathname === '/token' || url.pathname === '/v2/auth') {
			const authUrl = new URL(url.pathname + url.search, 'https://auth.docker.io');
			const authReq = new Request(authUrl, request);
			return fetch(authReq);
		}

		// 5. 组装请求上游的 URL
		url.hostname = hub_host;
		// Docker Hub 官方镜像路径规范化补全 (例如 ubuntu 补全为 library/ubuntu)
		if (hub_host === DEFAULT_HUB_HOST && /^\/v2\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) && !/^\/v2\/library/.test(url.pathname)) {
			url.pathname = '/v2/library/' + url.pathname.replace('/v2/', '');
		}

		// 6. 构造发往上游的请求参数
		const upstreamHeaders = new Headers(request.headers);
		upstreamHeaders.set('Host', hub_host);
		// 移除可能引起跨域或上游异常的无关请求头
		upstreamHeaders.delete('X-Forwarded-For');
		upstreamHeaders.delete('X-Real-IP');

		const proxyReq = new Request(url, {
			method: request.method,
			headers: upstreamHeaders,
			redirect: 'manual', // 关键：手动拦截 S3 重定向请求
			body: request.body
		});

		// 7. 发起请求获取上游响应
		let response = await fetch(proxyReq);
		const responseHeaders = new Headers(response.headers);

		// 8. 核心握手劫持：修改 WWW-Authenticate
		// 让 Docker 客户端认为 Worker 就是认证服务器，从而向 Worker 请求 Token，实现过墙
		if (responseHeaders.has('Www-Authenticate')) {
			let auth = responseHeaders.get('Www-Authenticate');
			auth = auth.replace(/https:\/\/auth\.docker\.io/g, workers_url);
			responseHeaders.set('Www-Authenticate', auth);
		}

		// 9. 处理 S3 / 对象存储 Blob 层的重定向拉取
		// 很多镜像层实际存在 AWS S3，如果直接重定向，Docker 客户端带 Authorization 去请求 S3 会报 400 错误，且过不了墙
		if ([301, 302, 303, 307, 308].includes(response.status) && responseHeaders.has('Location')) {
			const location = responseHeaders.get('Location');
			
			// 克隆请求头，但必须剔除鉴权信息
			const redirectReqHeaders = new Headers(request.headers);
			redirectReqHeaders.delete('Authorization');
			redirectReqHeaders.set('Host', new URL(location).host);

			// 主动拉取 S3 内容并以流的方式返回给客户端
			return fetch(location, {
				method: request.method,
				headers: redirectReqHeaders,
				redirect: 'follow'
			});
		}

		// 10. 返回处理好的最终响应
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders
		});
	}
};
