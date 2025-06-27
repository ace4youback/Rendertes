let canvas, gl;
let program;
let uniforms = {};
let startTime = Date.now();
let frameCount = 0;
let lastTime = 0;
let fps = 60;

// Camera controls
let camera = {
    position: [0, 0, 3],
    rotation: [0, 0],
    zoom: 1.0
};

let mouse = {
    x: 0, y: 0,
    lastX: 0, lastY: 0,
    isDown: false,
    rightDown: false
};

// Settings
let settings = {
    iterations: 128,
    power: 8.0,
    speed: 1.0,
    complexity: 1
};

const vertexShaderSource = `#version 300 es
    in vec2 a_position;
    out vec2 v_uv;
    
    void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

const fragmentShaderSource = `#version 300 es
    precision highp float;
    
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec3 u_camera_pos;
    uniform vec2 u_camera_rot;
    uniform float u_zoom;
    uniform float u_iterations;
    uniform float u_power;
    uniform float u_speed;
    uniform int u_complexity;
    
    in vec2 v_uv;
    out vec4 fragColor;
    
    #define PI 3.14159265359
    #define TAU 6.28318530718
    
    mat3 rotateX(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
    }
    
    mat3 rotateY(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
    }
    
    mat3 rotateZ(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
    }
    
    // Mandelbulb distance function
    float mandelbulb(vec3 pos) {
        vec3 z = pos;
        float dr = 1.0;
        float r = 0.0;
        
        for(int i = 0; i < int(u_iterations); i++) {
            r = length(z);
            if(r > 2.0) break;
            
            float theta = acos(z.z / r);
            float phi = atan(z.y, z.x);
            dr = pow(r, u_power - 1.0) * u_power * dr + 1.0;
            
            float zr = pow(r, u_power);
            theta = theta * u_power;
            phi = phi * u_power;
            
            z = zr * vec3(
                sin(theta) * cos(phi),
                sin(phi) * sin(theta),
                cos(theta)
            );
            z += pos;
        }
        
        return 0.5 * log(r) * r / dr;
    }
    
    // Menger sponge for complexity
    float mengerSponge(vec3 p) {
        float d = abs(p.x) - 1.0;
        d = max(d, abs(p.y) - 1.0);
        d = max(d, abs(p.z) - 1.0);
        
        float s = 1.0;
        for(int i = 0; i < 4; i++) {
            vec3 a = mod(p * s, 2.0) - 1.0;
            s *= 3.0;
            vec3 r = abs(1.0 - 3.0 * abs(a));
            
            float da = max(r.x, r.y);
            float db = max(r.y, r.z);
            float dc = max(r.z, r.x);
            float c = (min(da, min(db, dc)) - 1.0) / s;
            
            d = max(d, c);
        }
        
        return d;
    }
    
    // Combined distance function
    float distanceField(vec3 pos) {
        vec3 p = pos;
        
        // Add rotation animation
        float time = u_time * u_speed;
        p *= rotateY(time * 0.2);
        p *= rotateX(time * 0.15);
        
        float d1 = mandelbulb(p);
        
        if(u_complexity > 0) {
            float d2 = mengerSponge(p * 0.5) * 2.0;
            d1 = min(d1, d2);
        }
        
        return d1;
    }
    
    vec3 getNormal(vec3 pos) {
        float eps = 0.001;
        vec3 n = vec3(
            distanceField(pos + vec3(eps, 0, 0)) - distanceField(pos - vec3(eps, 0, 0)),
            distanceField(pos + vec3(0, eps, 0)) - distanceField(pos - vec3(0, eps, 0)),
            distanceField(pos + vec3(0, 0, eps)) - distanceField(pos - vec3(0, 0, eps))
        );
        return normalize(n);
    }
    
    vec3 rayMarch(vec3 rayOrigin, vec3 rayDirection) {
        float totalDistance = 0.0;
        vec3 currentPos;
        
        for(int i = 0; i < 100; i++) {
            currentPos = rayOrigin + rayDirection * totalDistance;
            float dist = distanceField(currentPos);
            
            if(dist < 0.001) {
                // Hit surface
                vec3 normal = getNormal(currentPos);
                
                // Lighting
                vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
                float diffuse = max(0.0, dot(normal, lightDir));
                
                vec3 viewDir = normalize(-rayDirection);
                vec3 reflectDir = reflect(-lightDir, normal);
                float specular = pow(max(0.0, dot(viewDir, reflectDir)), 32.0);
                
                // Color based on position and iterations
                vec3 color = vec3(0.5 + 0.5 * sin(totalDistance + u_time));
                color.r = 0.5 + 0.5 * sin(currentPos.x * 3.0 + u_time);
                color.g = 0.5 + 0.5 * sin(currentPos.y * 3.0 + u_time * 1.1);
                color.b = 0.5 + 0.5 * sin(currentPos.z * 3.0 + u_time * 1.2);
                
                return color * (diffuse * 0.8 + specular * 0.3 + 0.1);
            }
            
            if(totalDistance > 10.0) break;
            
            totalDistance += dist;
        }
        
        // Background gradient
        float gradient = 0.5 + 0.5 * rayDirection.y;
        return mix(vec3(0.0, 0.0, 0.1), vec3(0.0, 0.1, 0.2), gradient);
    }
    
    void main() {
        vec2 uv = (v_uv - 0.5) * 2.0;
        uv.x *= u_resolution.x / u_resolution.y;
        
        // Camera setup
        vec3 cameraPos = u_camera_pos * u_zoom;
        vec3 cameraTarget = vec3(0.0);
        vec3 cameraUp = vec3(0.0, 1.0, 0.0);
        
        // Apply camera rotation
        mat3 rotX = rotateX(u_camera_rot.y);
        mat3 rotY = rotateY(u_camera_rot.x);
        cameraPos = rotY * rotX * cameraPos;
        
        vec3 cameraForward = normalize(cameraTarget - cameraPos);
        vec3 cameraRight = normalize(cross(cameraForward, cameraUp));
        cameraUp = cross(cameraRight, cameraForward);
        
        vec3 rayDirection = normalize(cameraForward + uv.x * cameraRight + uv.y * cameraUp);
        
        vec3 color = rayMarch(cameraPos, rayDirection);
        
        // Tone mapping and gamma correction
        color = color / (color + vec3(1.0));
        color = pow(color, vec3(1.0/2.2));
        
        fragColor = vec4(color, 1.0);
    }
`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    
    return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program linking error:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    
    return program;
}

function init() {
    canvas = document.getElementById('canvas');
    gl = canvas.getContext('webgl2');
    
    if (!gl) {
        alert('WebGL 2.0 not supported!');
        return;
    }

    // Get GPU info
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        document.getElementById('gpu-info').textContent = `GPU: ${renderer}`;
    }

    resizeCanvas();
    
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    program = createProgram(gl, vertexShader, fragmentShader);
    
    // Create quad
    const positions = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1
    ]);
    
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    
    // Get uniform locations
    uniforms.resolution = gl.getUniformLocation(program, 'u_resolution');
    uniforms.time = gl.getUniformLocation(program, 'u_time');
    uniforms.camera_pos = gl.getUniformLocation(program, 'u_camera_pos');
    uniforms.camera_rot = gl.getUniformLocation(program, 'u_camera_rot');
    uniforms.zoom = gl.getUniformLocation(program, 'u_zoom');
    uniforms.iterations = gl.getUniformLocation(program, 'u_iterations');
    uniforms.power = gl.getUniformLocation(program, 'u_power');
    uniforms.speed = gl.getUniformLocation(program, 'u_speed');
    uniforms.complexity = gl.getUniformLocation(program, 'u_complexity');
    
    setupControls();
    
    document.getElementById('loading').style.display = 'none';
    render();
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    
    document.getElementById('resolution').textContent = `${canvas.width}x${canvas.height}`;
}

function setupControls() {
    // Mouse controls
    canvas.addEventListener('mousedown', (e) => {
        mouse.isDown = e.button === 0;
        mouse.rightDown = e.button === 2;
        mouse.lastX = e.clientX;
        mouse.lastY = e.clientY;
    });
    
    canvas.addEventListener('mouseup', () => {
        mouse.isDown = false;
        mouse.rightDown = false;
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (mouse.isDown) {
            const deltaX = e.clientX - mouse.lastX;
            const deltaY = e.clientY - mouse.lastY;
            
            camera.rotation[0] += deltaX * 0.01;
            camera.rotation[1] += deltaY * 0.01;
            camera.rotation[1] = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotation[1]));
        }
        
        if (mouse.rightDown) {
            const deltaX = e.clientX - mouse.lastX;
            const deltaY = e.clientY - mouse.lastY;
            
            camera.position[0] += deltaX * 0.01 * camera.zoom;
            camera.position[1] -= deltaY * 0.01 * camera.zoom;
        }
        
        mouse.lastX = e.clientX;
        mouse.lastY = e.clientY;
    });
    
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        camera.zoom *= Math.exp(e.deltaY * 0.001);
        camera.zoom = Math.max(0.1, Math.min(10, camera.zoom));
    });
    
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // UI controls
    document.getElementById('iterSlider').addEventListener('input', (e) => {
        settings.iterations = parseInt(e.target.value);
        document.getElementById('iterations').textContent = settings.iterations;
        updateComplexity();
    });
    
    document.getElementById('powerSlider').addEventListener('input', (e) => {
        settings.power = parseFloat(e.target.value);
    });
    
    document.getElementById('speedSlider').addEventListener('input', (e) => {
        settings.speed = parseFloat(e.target.value);
    });
    
    window.addEventListener('resize', resizeCanvas);
}

function updateComplexity() {
    let complexity = 'Low';
    if (settings.iterations > 100) complexity = 'Medium';
    if (settings.iterations > 150) complexity = 'High';
    if (settings.iterations > 200) complexity = 'Extreme';
    
    document.getElementById('complexity').textContent = complexity;
}

function setPreset(preset) {
    switch(preset) {
        case 'performance':
            settings.iterations = 64;
            settings.complexity = 0;
            document.getElementById('iterSlider').value = 64;
            break;
        case 'quality':
            settings.iterations = 128;
            settings.complexity = 1;
            document.getElementById('iterSlider').value = 128;
            break;
        case 'extreme':
            settings.iterations = 256;
            settings.complexity = 1;
            document.getElementById('iterSlider').value = 256;
            break;
        case 'psychedelic':
            settings.iterations = 96;
            settings.power = 12;
            settings.speed = 2;
            settings.complexity = 1;
            document.getElementById('iterSlider').value = 96;
            document.getElementById('powerSlider').value = 12;
            document.getElementById('speedSlider').value = 2;
            break;
    }
    
    document.getElementById('iterations').textContent = settings.iterations;
    updateComplexity();
}

function updateFPS() {
    const now = performance.now();
    frameCount++;
    
    if (now - lastTime >= 1000) {
        fps = Math.round(frameCount * 1000 / (now - lastTime));
        document.getElementById('fps').textContent = fps;
        frameCount = 0;
        lastTime = now;
    }
}

function render() {
    updateFPS();
    
    gl.useProgram(program);
    
    const time = (Date.now() - startTime) * 0.001;
    
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.time, time);
    gl.uniform3fv(uniforms.camera_pos, camera.position);
    gl.uniform2fv(uniforms.camera_rot, camera.rotation);
    gl.uniform1f(uniforms.zoom, camera.zoom);
    gl.uniform1f(uniforms.iterations, settings.iterations);
    gl.uniform1f(uniforms.power, settings.power);
    gl.uniform1f(uniforms.speed, settings.speed);
    gl.uniform1i(uniforms.complexity, settings.complexity);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    requestAnimationFrame(render);
}

// Initialize when page loads
window.addEventListener('load', init);