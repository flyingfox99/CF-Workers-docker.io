主要优化点说明：
1. 彻底修复内存泄漏 (CPU 释放)
删除了原代码顶部的 let 屏蔽爬虫UA = ... 与 let hub_host = ...。Cloudflare Workers 实例在热启动时会复用外层变量。将这些变量移入 fetch 作用域内，确保无论并发多高，用户的路由和配置绝不会串车。

2. 剔除了服务端主动获取 Token 的冗余逻辑
原代码中在 /v2/ 拦截层里写了一大段 await fetch(tokenUrl...) 去主动申请 token 然后附加 header 给上游。这是没有必要且极度消耗 Worker 执行时间的。
优化后采用标准握手机制：Docker 客户端发起请求 → 上游返回 401 和认证地址 → Worker 将地址替换为自己的域名 → 客户端拿着自己的账户/匿名身份向 Worker 请求 Token。这样不仅代码精简了近 80 行，且降低了拉取时的首字节响应时间。

3. 精简了庞大的前端 UI 模板
原代码内嵌了整整几百行的 CSS 和 HTML（为了实现一个简单的镜像搜索页面）。在“只为跨域代理拉取镜像”的实际需求下，这不仅无用，还会拖慢文件解析速度。保留了极简的 Nginx 伪装页，既遵循了不被安全扫描工具判定为 "Open Proxy" (Cloudflare封禁红线) 的要求，又保持了轻量。

4. 精简了 S3 / Blob 下载重定向逻辑
抛弃了原代码中晦涩的 httpHandler 与 proxy 函数套娃，直接通过拦截 response.status === 302 并去除 Authorization 头发起原生 fetch(Location) 即可完成无缝数据中转拉取。


+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
===================================================================================================

[**第三方 DockerHub 镜像服务列表**](https://github.com/cmliu/CF-Workers-docker.io?tab=readme-ov-file#%E7%AC%AC%E4%B8%89%E6%96%B9-dockerhub-%E9%95%9C%E5%83%8F%E6%9C%8D%E5%8A%A1)

# CF-Workers-docker.io：Docker仓库镜像代理工具

这个项目是一个基于 Cloudflare Workers 的 Docker 镜像代理工具。它能够中转对 Docker 官方镜像仓库的请求，解决一些访问限制和加速访问的问题。

## 部署方式

- **Workers** 部署：复制 [_worker.js](https://github.com/cmliu/CF-Workers-docker.io/blob/main/_worker.js) 代码，`保存并部署`即可
- **Pages** 部署：`Fork` 后 `连接GitHub` 一键部署即可

## 如何使用？ [视频教程](https://www.youtube.com/watch?v=l2jwq9CagNQ)

例如您的Workers项目域名为：`docker.shareigain.top`；

### 1.官方镜像路径前面加域名
```shell
docker pull docker.shareisgain.top/stilleshan/frpc:latest
```
```shell
docker pull docker.shareisgain.top/library/nginx:stable-alpine3.19-perl
```

### 2.一键设置镜像加速
修改文件 `/etc/docker/daemon.json`（如果不存在则创建）
```shell
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": ["https://docker.fxxk.dedyn.io"]  # 请替换为您自己的Worker自定义域名
}
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker
```
### 3. 配置常见仓库的镜像加速
#### 3.1 配置  
Containerd 较简单，它支持任意 `registry` 的 `mirror`，只需要修改配置文件 `/etc/containerd/config.toml`，添加如下的配置：  
```yaml
    [plugins."io.containerd.grpc.v1.cri".registry]
      [plugins."io.containerd.grpc.v1.cri".registry.mirrors]
        [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
          endpoint = ["https://xxxx.xx.com"]
        [plugins."io.containerd.grpc.v1.cri".registry.mirrors."k8s.gcr.io"]
          endpoint = ["https://xxxx.xx.com"]
        [plugins."io.containerd.grpc.v1.cri".registry.mirrors."gcr.io"]
          endpoint = ["https://xxxx.xx.com"]
        [plugins."io.containerd.grpc.v1.cri".registry.mirrors."ghcr.io"]
          endpoint = ["https://xxxx.xx.com"]
        [plugins."io.containerd.grpc.v1.cri".registry.mirrors."quay.io"]
          endpoint = ["https://xxxx.xx.com"]
```
`Podman` 同样支持任意 `registry` 的 `mirror`，修改配置文件 `/etc/containers/registries.conf`，添加配置：  
```yaml
unqualified-search-registries = ['docker.io', 'k8s.gcr.io', 'gcr.io', 'ghcr.io', 'quay.io']

[[registry]]
prefix = "docker.io"
insecure = true
location = "registry-1.docker.io"

[[registry.mirror]]
location = "xxxx.xx.com"

[[registry]]
prefix = "k8s.gcr.io"
insecure = true
location = "k8s.gcr.io"

[[registry.mirror]]
location = "xxxx.xx.com"

[[registry]]
prefix = "gcr.io"
insecure = true
location = "gcr.io"

[[registry.mirror]]
location = "xxxx.xx.com"

[[registry]]
prefix = "ghcr.io"
insecure = true
location = "ghcr.io"

[[registry.mirror]]
location = "xxxx.xx.com"

[[registry]]
prefix = "quay.io"
insecure = true
location = "quay.io"

[[registry.mirror]]
location = "xxxx.xx.com"

```

#### 3.3 使用
对于以上配置，k8s在使用的时候，就可以直接`pull`外部无法pull的镜像了 
 手动可以直接`pull` 配置了`mirror`的仓库  
 `crictl pull registry.k8s.io/kube-proxy:v1.28.4`
 `docker  pull nginx:1.21`






## 变量说明
| 变量名 | 示例 | 必填 | 备注 | 
|--|--|--|--|
| URL302 | https://t.me/CMLiussss |❌| 主页302跳转 |
| URL | https://www.baidu.com/ |❌| 主页伪装(设为`nginx`则伪装为nginx默认页面) |
| UA | netcraft |❌| 支持多元素, 元素之间使用空格或换行作间隔 |




# 第三方 DockerHub 镜像服务

**注意:**
- 以下内容仅做镜像服务的整理与搜集，未做任何安全性检测和验证。
- 使用前请自行斟酌，并根据实际需求进行必要的安全审查。
- 本列表中的任何服务都不做任何形式的安全承诺或保证。

| DockerHub 镜像仓库 | 镜像加地址 |
| ------------------ | ----------- |
| [bestcfipas镜像服务](https://t.me/bestcfipas/1900) | `https://docker.registry.cyou` |
|  | `https://docker-cf.registry.cyou` |
| [zero_free镜像服务](https://t.me/zero_free/80) | `https://docker.jsdelivr.fyi` |
|  | `https://dockercf.jsdelivr.fyi` |
|  | `https://dockertest.jsdelivr.fyi` |
| [docker proxy](https://dockerpull.com/) | `https://dockerpull.com` |
| [docker proxy](https://dockerproxy.cn/) | `https://dockerproxy.cn` |
| [Docker镜像加速站](https://hub.uuuadc.top/) | `https://hub.uuuadc.top` |
|  | `https://docker.1panel.live` |
|  | `https://hub.rat.dev` |
| [DockerHub 镜像加速代理](https://docker.anyhub.us.kg/) | `https://docker.anyhub.us.kg` |
|  | `https://docker.chenby.cn` |
|  | `https://dockerhub.jobcher.com` |
| [镜像使用说明](https://dockerhub.icu/) | `https://dockerhub.icu` |
| [Docker镜像加速站](https://docker.ckyl.me/) | `https://docker.ckyl.me` |
| [镜像使用说明](https://docker.awsl9527.cn/) | `https://docker.awsl9527.cn` |
| [镜像使用说明](https://docker.hpcloud.cloud/) | `https://docker.hpcloud.cloud` |
| [DaoCloud 镜像站](https://github.com/DaoCloud/public-image-mirror) | `https://docker.m.daocloud.io` |
| [AtomHub 可信镜像仓库平台](https://atomhub.openatom.cn/) (只包含基础镜像，共336个) | `https://atomhub.openatom.cn` |





# 鸣谢

[muzihuaner](https://github.com/muzihuaner)、[V2ex网友](https://global.v2ex.com/t/1007922)、[ciiiii](https://github.com/ciiiii/cloudflare-docker-proxy)、[ChatGPT](https://chatgpt.com/)、[白嫖哥](https://t.me/bestcfipas/1900)、[zero_free频道](https://t.me/zero_free/80)、[dongyubin](https://github.com/cmliu/CF-Workers-docker.io/issues/8)、[kiko923](https://github.com/cmliu/CF-Workers-docker.io/issues/5)

