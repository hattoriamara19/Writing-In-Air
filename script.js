/* =========================================================
   AIR PEN WRITING
   VERSION 9
   PURE JAVASCRIPT
   NO OPENCV
   ========================================================= */


/* =========================================================
   ELEMENTS
   ========================================================= */

const video =
    document.getElementById("camera");

const overlayCanvas =
    document.getElementById("overlayCanvas");

const processingCanvas =
    document.getElementById("processingCanvas");

const drawingCanvas =
    document.getElementById("drawingCanvas");

const detectedDot =
    document.getElementById("detectedDot");

const cameraMessage =
    document.getElementById("cameraMessage");

const status =
    document.getElementById("status");

const cameraMode =
    document.getElementById("cameraMode");


const startBtn =
    document.getElementById("startBtn");

const calibrateBtn =
    document.getElementById("calibrateBtn");

const switchBtn =
    document.getElementById("switchBtn");

const stopBtn =
    document.getElementById("stopBtn");

const undoBtn =
    document.getElementById("undoBtn");

const clearBtn =
    document.getElementById("clearBtn");

const saveBtn =
    document.getElementById("saveBtn");


/* =========================================================
   CANVAS CONTEXTS
   ========================================================= */

const overlayCtx =
    overlayCanvas.getContext("2d");

const processingCtx =
    processingCanvas.getContext("2d");

const drawingCtx =
    drawingCanvas.getContext("2d");


/* =========================================================
   CAMERA VARIABLES
   ========================================================= */

let cameraStream = null;

let cameraFacing = "user";

let cameraRunning = false;

let animationId = null;


/* =========================================================
   PROCESSING RESOLUTION
   ========================================================= */

const PROCESS_WIDTH = 320;
const PROCESS_HEIGHT = 240;


/* =========================================================
   COLOR DETECTION
   ========================================================= */

/*
   HSV-like detection.

   We calculate RGB -> HSV ourselves.

   Target:
   bright green/yellow
*/

const MIN_SATURATION = 0.35;
const MIN_VALUE = 0.35;


/*
   Green/yellow hue range.

   Hue:
   0     = red
   60    = green
   120   = blue

   We accept roughly yellow -> green.
*/

const MIN_HUE = 35;
const MAX_HUE = 150;


/*
   Detection area limits.
*/

const MIN_BLOB_AREA = 15;
const MAX_BLOB_AREA = 5000;


/* =========================================================
   SMOOTHING
   ========================================================= */

let smoothX = null;
let smoothY = null;

const SMOOTHING = 0.35;


/* =========================================================
   CALIBRATION
   ========================================================= */

let calibrationActive = false;

let calibrationPoints = [];

let calibrationIndex = 0;

let perspectiveMatrix = null;


const calibrationNames = [

    "TOP-LEFT",

    "TOP-RIGHT",

    "BOTTOM-RIGHT",

    "BOTTOM-LEFT"

];


/* =========================================================
   PEN-UP ZONE
   ========================================================= */

const PEN_UP_ZONE = {

    x: 0.10,

    y: 0.10,

    radius: 0.10

};


/* =========================================================
   WRITING
   ========================================================= */

let writingEnabled = false;

let strokes = [];

let currentStroke = [];

let lastDrawX = null;

let lastDrawY = null;


/* =========================================================
   RESIZE CANVASES
   ========================================================= */

function resizeCanvases() {

    const overlayRect =
        overlayCanvas.getBoundingClientRect();


    overlayCanvas.width =
        Math.max(
            1,
            Math.floor(overlayRect.width)
        );

    overlayCanvas.height =
        Math.max(
            1,
            Math.floor(overlayRect.height)
        );


    const drawingRect =
        drawingCanvas.getBoundingClientRect();


    drawingCanvas.width =
        Math.max(
            1,
            Math.floor(drawingRect.width)
        );

    drawingCanvas.height =
        Math.max(
            1,
            Math.floor(drawingRect.height)
        );


    drawingCtx.lineCap =
        "round";

    drawingCtx.lineJoin =
        "round";


    redrawAllStrokes();


    if (cameraRunning) {

        if (calibrationActive) {

            drawCalibrationOverlay();

        } else {

            drawNormalOverlay();

        }

    }

}


window.addEventListener(
    "resize",
    resizeCanvases
);


setTimeout(
    resizeCanvases,
    500
);


/* =========================================================
   START CAMERA
   ========================================================= */

async function startCamera() {

    await stopCamera();


    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {

        status.textContent =
            "Camera unavailable. Use HTTPS or localhost.";

        return;

    }


    try {

        cameraMessage.textContent =
            "Starting camera...";


        const constraints = {

            audio: false,

            video: {

                facingMode: {
                    ideal: cameraFacing
                },

                width: {
                    ideal: 1280
                },

                height: {
                    ideal: 720
                }

            }

        };


        cameraStream =
            await navigator.mediaDevices
                .getUserMedia(constraints);


        video.srcObject =
            cameraStream;


        await video.play();


        cameraRunning =
            true;


        cameraMessage.style.display =
            "none";


        cameraMode.textContent =
            cameraFacing === "user"
                ? "Front"
                : "Back";


        smoothX = null;
        smoothY = null;


        status.textContent =
            "Camera started. Show the colored pen tip.";


        resizeCanvases();


        detectLoop();


    } catch (error) {

        console.error(
            "Camera error:",
            error
        );


        cameraRunning =
            false;


        cameraMessage.style.display =
            "block";


        cameraMessage.textContent =
            "Camera access failed.";


        status.textContent =
            "Allow camera permission and use HTTPS.";

    }

}


/* =========================================================
   STOP CAMERA
   ========================================================= */

async function stopCamera() {

    cameraRunning =
        false;


    if (animationId !== null) {

        cancelAnimationFrame(
            animationId
        );

        animationId =
            null;

    }


    if (cameraStream) {

        cameraStream
            .getTracks()
            .forEach(
                track => track.stop()
            );

        cameraStream =
            null;

    }


    video.srcObject =
        null;


    detectedDot.style.display =
        "none";


    cameraMessage.style.display =
        "block";


    cameraMessage.textContent =
        "Camera stopped.";


    smoothX = null;
    smoothY = null;


    finishCurrentStroke();

}


/* =========================================================
   SWITCH CAMERA
   ========================================================= */

async function switchCamera() {

    cameraFacing =
        cameraFacing === "user"
            ? "environment"
            : "user";


    cameraMode.textContent =
        cameraFacing === "user"
            ? "Front"
            : "Back";


    if (cameraStream) {

        await startCamera();

    } else {

        status.textContent =
            "Selected " +
            (
                cameraFacing === "user"
                    ? "Front"
                    : "Back"
            ) +
            " camera.";

    }

}


/* =========================================================
   DETECTION LOOP
   ========================================================= */

function detectLoop() {

    if (!cameraRunning) {

        return;

    }


    detectPen();


    animationId =
        requestAnimationFrame(
            detectLoop
        );

}


/* =========================================================
   RGB -> HSV
   ========================================================= */

function rgbToHsv(
    r,
    g,
    b
) {

    r /= 255;
    g /= 255;
    b /= 255;


    const max =
        Math.max(r, g, b);

    const min =
        Math.min(r, g, b);


    const difference =
        max - min;


    let h = 0;


    if (difference === 0) {

        h = 0;

    } else if (max === r) {

        h =
            60 *
            (
                (
                    (g - b) /
                    difference
                ) % 6
            );

    } else if (max === g) {

        h =
            60 *
            (
                (b - r) /
                difference +
                2
            );

    } else {

        h =
            60 *
            (
                (r - g) /
                difference +
                4
            );

    }


    if (h < 0) {

        h += 360;

    }


    const s =
        max === 0
            ? 0
            : difference / max;


    const v =
        max;


    return {
        h: h,
        s: s,
        v: v
    };

}


/* =========================================================
   CHECK TARGET COLOR
   ========================================================= */

function isTargetColor(
    r,
    g,
    b
) {

    const hsv =
        rgbToHsv(
            r,
            g,
            b
        );


    if (
        hsv.s < MIN_SATURATION
    ) {

        return false;

    }


    if (
        hsv.v < MIN_VALUE
    ) {

        return false;

    }


    if (
        hsv.h < MIN_HUE ||
        hsv.h > MAX_HUE
    ) {

        return false;

    }


    /*
       Extra brightness check.

       Green/yellow marker should be
       brighter than the surroundings.
    */

    const brightness =
        (
            r +
            g +
            b
        ) / 3;


    if (brightness < 80) {

        return false;

    }


    return true;

}


/* =========================================================
   DETECT PEN
   ========================================================= */

function detectPen() {

    if (
        !video.videoWidth ||
        !video.videoHeight
    ) {

        return;

    }


    const W =
        PROCESS_WIDTH;

    const H =
        PROCESS_HEIGHT;


    processingCanvas.width =
        W;

    processingCanvas.height =
        H;


    processingCtx.drawImage(
        video,
        0,
        0,
        W,
        H
    );


    let imageData;


    try {

        imageData =
            processingCtx.getImageData(
                0,
                0,
                W,
                H
            );

    } catch (error) {

        console.error(
            "Canvas error:",
            error
        );

        return;

    }


    const data =
        imageData.data;


    /*
       Downsample detection grid.

       We do not inspect every pixel.

       This improves Android performance.
    */

    const STEP = 2;


    /*
       Binary mask.

       1 = target color
       0 = background
    */

    const mask =
        new Uint8Array(
            W * H
        );


    let coloredPixels = 0;


    for (
        let y = 0;
        y < H;
        y += STEP
    ) {

        for (
            let x = 0;
            x < W;
            x += STEP
        ) {

            const index =
                (
                    y * W +
                    x
                ) * 4;


            const r =
                data[index];

            const g =
                data[index + 1];

            const b =
                data[index + 2];


            if (
                isTargetColor(
                    r,
                    g,
                    b
                )
            ) {

                mask[
                    y * W + x
                ] = 1;

                coloredPixels++;

            }

        }

    }


    /*
       If almost nothing is detected,
       stop.
    */

    if (
        coloredPixels <
        MIN_BLOB_AREA
    ) {

        noPenDetected();

        return;

    }


    /*
       Connected component search.

       This replaces OpenCV contour detection.
    */

    const visited =
        new Uint8Array(
            W * H
        );


    let bestBlob =
        null;


    /*
       Search only every STEP pixel.
    */

    for (
        let y = 0;
        y < H;
        y += STEP
    ) {

        for (
            let x = 0;
            x < W;
            x += STEP
        ) {

            const index =
                y * W + x;


            if (
                mask[index] === 0 ||
                visited[index] === 1
            ) {

                continue;

            }


            const blob =
                floodFill(
                    x,
                    y,
                    mask,
                    visited,
                    W,
                    H,
                    STEP
                );


            if (
                !blob ||
                blob.count <
                MIN_BLOB_AREA
            ) {

                continue;

            }


            if (
                blob.count >
                MAX_BLOB_AREA
            ) {

                continue;

            }


            /*
               Score the blob.
            */

            const score =
                scoreBlob(
                    blob
                );


            if (
                !bestBlob ||
                score >
                bestBlob.score
            ) {

                bestBlob = {

                    ...blob,

                    score: score

                };

            }

        }

    }


    if (!bestBlob) {

        noPenDetected();

        return;

    }


    /*
       Raw detected center.
    */

    const rawX =
        bestBlob.cx;

    const rawY =
        bestBlob.cy;


    /*
       Smooth movement.
    */

    if (
        smoothX === null
    ) {

        smoothX =
            rawX;

        smoothY =
            rawY;

    } else {

        smoothX =
            smoothX +
            SMOOTHING *
            (
                rawX -
                smoothX
            );


        smoothY =
            smoothY +
            SMOOTHING *
            (
                rawY -
                smoothY
            );

    }


    /*
       Show red tracking dot.
    */

    showDetectedDot(
        smoothX,
        smoothY,
        W,
        H
    );


    /*
       Process writing.
    */

    processDetectedPen(
        smoothX,
        smoothY,
        W,
        H
    );

}


/* =========================================================
   FLOOD FILL
   ========================================================= */

function floodFill(
    startX,
    startY,
    mask,
    visited,
    W,
    H,
    STEP
) {

    const queueX = [];
    const queueY = [];


    queueX.push(startX);
    queueY.push(startY);


    visited[
        startY * W +
        startX
    ] = 1;


    let head = 0;

    let count = 0;

    let sumX = 0;

    let sumY = 0;

    let minX = startX;

    let maxX = startX;

    let minY = startY;

    let maxY = startY;


    while (
        head <
        queueX.length
    ) {

        const x =
            queueX[head];

        const y =
            queueY[head];


        head++;


        count++;


        sumX += x;
        sumY += y;


        minX =
            Math.min(
                minX,
                x
            );

        maxX =
            Math.max(
                maxX,
                x
            );

        minY =
            Math.min(
                minY,
                y
            );

        maxY =
            Math.max(
                maxY,
                y
            );


        /*
           8-neighbour search.
        */

        const neighbors = [

            [x + STEP, y],

            [x - STEP, y],

            [x, y + STEP],

            [x, y - STEP],

            [x + STEP, y + STEP],

            [x - STEP, y - STEP],

            [x + STEP, y - STEP],

            [x - STEP, y + STEP]

        ];


        for (
            const point
            of neighbors
        ) {

            const nx =
                point[0];

            const ny =
                point[1];


            if (
                nx < 0 ||
                nx >= W ||
                ny < 0 ||
                ny >= H
            ) {

                continue;

            }


            const index =
                ny * W +
                nx;


            if (
                mask[index] === 1 &&
                visited[index] === 0
            ) {

                visited[index] = 1;

                queueX.push(nx);

                queueY.push(ny);

            }

        }


        /*
           Safety limit.
        */

        if (
            count >
            MAX_BLOB_AREA * 2
        ) {

            break;

        }

    }


    if (count === 0) {

        return null;

    }


    return {

        count: count,

        cx: sumX / count,

        cy: sumY / count,

        width:
            maxX - minX,

        height:
            maxY - minY,

        minX: minX,

        maxX: maxX,

        minY: minY,

        maxY: maxY

    };

}


/* =========================================================
   BLOB SCORING
   ========================================================= */

function scoreBlob(
    blob
) {

    /*
       We prefer medium-sized,
       compact colored regions.
    */

    const compactness =
        blob.count /
        Math.max(
            1,
            blob.width *
            blob.height /
            4
        );


    let score =
        Math.min(
            blob.count / 100,
            10
        );


    score +=
        Math.min(
            compactness * 5,
            10
        );


    /*
       If previous position exists,
       prefer nearby object.
    */

    if (
        smoothX !== null &&
        smoothY !== null
    ) {

        const dx =
            blob.cx -
            smoothX;

        const dy =
            blob.cy -
            smoothY;


        const distance =
            Math.sqrt(
                dx * dx +
                dy * dy
            );


        const proximity =
            Math.max(
                0,
                1 -
                distance / 160
            );


        score +=
            proximity * 15;

    }


    return score;

}


/* =========================================================
   NO PEN
   ========================================================= */

function noPenDetected() {

    detectedDot.style.display =
        "none";


    if (
        !calibrationActive
    ) {

        finishCurrentStroke();


        status.textContent =
            "🔍 Pen tip not detected. Show green/yellow marker.";

        drawNormalOverlay();

    }

}


/* =========================================================
   SHOW DETECTED DOT
   ========================================================= */

function showDetectedDot(
    x,
    y,
    width,
    height
) {

    const rect =
        overlayCanvas
            .getBoundingClientRect();


    let displayX =
        x / width *
        rect.width;


    let displayY =
        y / height *
        rect.height;


    /*
       Front camera preview is mirrored.
    */

    if (
        cameraFacing === "user"
    ) {

        displayX =
            rect.width -
            displayX;

    }


    detectedDot.style.left =
        displayX + "px";


    detectedDot.style.top =
        displayY + "px";


    detectedDot.style.display =
        "block";

}


/* =========================================================
   DISPLAY CAMERA POINT
   ========================================================= */

function getDisplayCameraPoint(
    rawX,
    rawY,
    width,
    height
) {

    let x =
        rawX;

    let y =
        rawY;


    if (
        cameraFacing === "user"
    ) {

        x =
            width -
            rawX;

    }


    return {

        x: x,

        y: y

    };

}


/* =========================================================
   PROCESS DETECTED PEN
   ========================================================= */

function processDetectedPen(
    x,
    y,
    width,
    height
) {

    /*
       Calibration mode.
    */

    if (
        calibrationActive
    ) {

        drawCalibrationOverlay();

        return;

    }


    /*
       Calibration required.
    */

    if (
        !perspectiveMatrix
    ) {

        finishCurrentStroke();


        status.textContent =
            "🎯 Calibrate the 4 corners first.";


        drawNormalOverlay();


        return;

    }


    const displayPoint =
        getDisplayCameraPoint(
            x,
            y,
            width,
            height
        );


    /*
       PEN-UP area.
    */

    const zoneX =
        width *
        PEN_UP_ZONE.x;


    const zoneY =
        height *
        PEN_UP_ZONE.y;


    const zoneRadius =
        Math.min(
            width,
            height
        ) *
        PEN_UP_ZONE.radius;


    const dx =
        displayPoint.x -
        zoneX;


    const dy =
        displayPoint.y -
        zoneY;


    const distance =
        Math.sqrt(
            dx * dx +
            dy * dy
        );


    if (
        distance <=
        zoneRadius
    ) {

        if (
            writingEnabled
        ) {

            finishCurrentStroke();

            writingEnabled =
                false;

        }


        status.textContent =
            "🟡 PEN-UP • Writing paused.";


        drawNormalOverlay();


        return;

    }


    writingEnabled =
        true;


    /*
       Transform camera point
       into writing canvas.
    */

    const mapped =
        transformPoint(
            x,
            y
        );


    if (!mapped) {

        return;

    }


    /*
       Prevent huge accidental lines
       when detection jumps.
    */

    if (
        lastDrawX !== null &&
        lastDrawY !== null
    ) {

        const dx =
            mapped.x -
            lastDrawX;


        const dy =
            mapped.y -
            lastDrawY;


        const distance =
            Math.sqrt(
                dx * dx +
                dy * dy
            );


        if (
            distance > 180
        ) {

            finishCurrentStroke();


            lastDrawX =
                mapped.x;


            lastDrawY =
                mapped.y;


            return;

        }

    }


    drawAirWriting(
        mapped.x,
        mapped.y
    );


    status.textContent =
        "✍️ Writing...";

}


/* =========================================================
   CALIBRATION START
   ========================================================= */

function startCalibration() {

    if (
        !cameraRunning
    ) {

        status.textContent =
            "Start the camera first.";

        return;

    }


    calibrationActive =
        true;


    calibrationPoints =
        [];


    calibrationIndex =
        0;


    perspectiveMatrix =
        null;


    writingEnabled =
        false;


    finishCurrentStroke();


    status.textContent =
        "Move pen tip to TOP-LEFT.";


    drawCalibrationOverlay();

}


/* =========================================================
   RECORD CALIBRATION POINT
   ========================================================= */

function recordCalibrationPoint(
    rawX,
    rawY
) {

    if (
        !calibrationActive
    ) {

        return;

    }


    calibrationPoints.push({

        x: rawX,

        y: rawY

    });


    const name =
        calibrationNames[
            calibrationIndex
        ];


    calibrationIndex++;


    if (
        calibrationIndex < 4
    ) {

        status.textContent =
            "✓ " +
            name +
            " recorded. Move to " +
            calibrationNames[
                calibrationIndex
            ] +
            ".";


        drawCalibrationOverlay();


        return;

    }


    finishCalibration();

}


/* =========================================================
   4-POINT HOMOGRAPHY
   ========================================================= */

/*
   We calculate the perspective transform
   ourselves.

   No OpenCV.
*/

function calculateHomography(
    src,
    dst
) {

    const A = [];
    const B = [];


    for (
        let i = 0;
        i < 4;
        i++
    ) {

        const x =
            src[i].x;

        const y =
            src[i].y;

        const X =
            dst[i].x;

        const Y =
            dst[i].y;


        A.push([

            x,
            y,
            1,
            0,
            0,
            0,
            -X * x,
            -X * y

        ]);


        B.push(X);


        A.push([

            0,
            0,
            0,
            x,
            y,
            1,
            -Y * x,
            -Y * y

        ]);


        B.push(Y);

    }


    const h =
        solveLinearSystem(
            A,
            B
        );


    if (!h) {

        return null;

    }


    return {

        h11: h[0],

        h12: h[1],

        h13: h[2],

        h21: h[3],

        h22: h[4],

        h23: h[5],

        h31: h[6],

        h32: h[7],

        h33: 1

    };

}


/* =========================================================
   GAUSSIAN ELIMINATION
   ========================================================= */

function solveLinearSystem(
    A,
    B
) {

    const n =
        B.length;


    const matrix =
        A.map(
            (row, i) => [
                ...row,
                B[i]
            ]
        );


    for (
        let col = 0;
        col < n;
        col++
    ) {

        let pivot =
            col;


        for (
            let row = col + 1;
            row < n;
            row++
        ) {

            if (
                Math.abs(
                    matrix[row][col]
                ) >
                Math.abs(
                    matrix[pivot][col]
                )
            ) {

                pivot =
                    row;

            }

        }


        if (
            Math.abs(
                matrix[pivot][col]
            ) < 0.00000001
        ) {

            return null;

        }


        [
            matrix[col],
            matrix[pivot]
        ] =
        [
            matrix[pivot],
            matrix[col]
        ];


        const divisor =
            matrix[col][col];


        for (
            let j = col;
            j <= n;
            j++
        ) {

            matrix[col][j] /=
                divisor;

        }


        for (
            let row = 0;
            row < n;
            row++
        ) {

            if (
                row === col
            ) {

                continue;

            }


            const factor =
                matrix[row][col];


            for (
                let j = col;
                j <= n;
                j++
            ) {

                matrix[row][j] -=
                    factor *
                    matrix[col][j];

            }

        }

    }


    return matrix.map(
        row =>
            row[n]
    );

}


/* =========================================================
   FINISH CALIBRATION
   ========================================================= */

function finishCalibration() {

    if (
        calibrationPoints.length !== 4
    ) {

        return;

    }


    const src = [

        calibrationPoints[0],

        calibrationPoints[1],

        calibrationPoints[2],

        calibrationPoints[3]

    ];


    const dst = [

        {
            x: 0,

            y: 0

        },

        {
            x:
                drawingCanvas.width,

            y: 0

        },

        {
            x:
                drawingCanvas.width,

            y:
                drawingCanvas.height

        },

        {
            x: 0,

            y:
                drawingCanvas.height

        }

    ];


    perspectiveMatrix =
        calculateHomography(
            src,
            dst
        );


    if (
        !perspectiveMatrix
    ) {

        calibrationActive =
            false;


        status.textContent =
            "❌ Calibration failed. Try again.";


        return;

    }


    calibrationActive =
        false;


    calibrationIndex =
        0;


    writingEnabled =
        false;


    finishCurrentStroke();


    status.textContent =
        "✅ Calibration complete! Move pen to write.";


    drawNormalOverlay();

}


/* =========================================================
   TRANSFORM POINT
   ========================================================= */

function transformPoint(
    x,
    y
) {

    if (
        !perspectiveMatrix
    ) {

        return null;

    }


    const m =
        perspectiveMatrix;


    const denominator =
        m.h31 * x +
        m.h32 * y +
        m.h33;


    if (
        Math.abs(
            denominator
        ) < 0.000001
    ) {

        return null;

    }


    const newX =
        (
            m.h11 * x +
            m.h12 * y +
            m.h13
        ) /
        denominator;


    const newY =
        (
            m.h21 * x +
            m.h22 * y +
            m.h23
        ) /
        denominator;


    return {

        x:
            Math.max(
                0,
                Math.min(
                    drawingCanvas.width,
                    newX
                )
            ),

        y:
            Math.max(
                0,
                Math.min(
                    drawingCanvas.height,
                    newY
                )
            )

    };

}


/* =========================================================
   CALIBRATION OVERLAY
   ========================================================= */

function drawCalibrationOverlay() {

    const rect =
        overlayCanvas
            .getBoundingClientRect();


    const W =
        rect.width;


    const H =
        rect.height;


    overlayCtx.clearRect(
        0,
        0,
        W,
        H
    );


    /*
       Dark transparent layer.
    */

    overlayCtx.fillStyle =
        "rgba(0,0,0,0.25)";


    overlayCtx.fillRect(
        0,
        0,
        W,
        H
    );


    /*
       Calibration targets.
    */

    const targets = [

        {
            x: W * 0.10,
            y: H * 0.10
        },

        {
            x: W * 0.90,
            y: H * 0.10
        },

        {
            x: W * 0.90,
            y: H * 0.90
        },

        {
            x: W * 0.10,
            y: H * 0.90
        }

    ];


    for (
        let i = 0;
        i < targets.length;
        i++
    ) {

        const p =
            targets[i];


        const completed =
            i <
            calibrationPoints.length;


        const active =
            i ===
            calibrationIndex;


        overlayCtx.beginPath();


        overlayCtx.arc(
            p.x,
            p.y,
            active
                ? 27
                : 18,
            0,
            Math.PI * 2
        );


        overlayCtx.strokeStyle =
            active
                ? "yellow"
                : completed
                    ? "lime"
                    : "white";


        overlayCtx.lineWidth =
            active
                ? 5
                : 3;


        overlayCtx.stroke();


        overlayCtx.beginPath();


        overlayCtx.arc(
            p.x,
            p.y,
            5,
            0,
            Math.PI * 2
        );


        overlayCtx.fillStyle =
            active
                ? "yellow"
                : completed
                    ? "lime"
                    : "white";


        overlayCtx.fill();


        overlayCtx.font =
            "bold 14px Arial";


        overlayCtx.fillStyle =
            "white";


        overlayCtx.textAlign =
            "center";


        overlayCtx.fillText(
            calibrationNames[i],
            p.x,
            p.y + 45
        );

    }


    overlayCtx.font =
        "bold 16px Arial";


    overlayCtx.fillStyle =
        "yellow";


    overlayCtx.textAlign =
        "center";


    overlayCtx.fillText(

        "Move pen tip to " +

        calibrationNames[
            calibrationIndex
        ],

        W / 2,

        H / 2

    );

}


/* =========================================================
   NORMAL CAMERA OVERLAY
   ========================================================= */

function drawNormalOverlay() {

    const rect =
        overlayCanvas
            .getBoundingClientRect();


    const W =
        rect.width;


    const H =
        rect.height;


    overlayCtx.clearRect(
        0,
        0,
        W,
        H
    );


    /*
       Writing boundary.
    */

    overlayCtx.strokeStyle =
        "rgba(0,255,0,0.6)";


    overlayCtx.lineWidth =
        2;


    overlayCtx.strokeRect(

        W * 0.10,

        H * 0.10,

        W * 0.80,

        H * 0.80

    );


    /*
       PEN-UP.
    */

    drawPenUpZone(
        W,
        H
    );

}


/* =========================================================
   PEN-UP ZONE DRAWING
   ========================================================= */

function drawPenUpZone(
    width,
    height
) {

    const x =
        width *
        PEN_UP_ZONE.x;


    const y =
        height *
        PEN_UP_ZONE.y;


    const radius =
        Math.min(
            width,
            height
        ) *
        PEN_UP_ZONE.radius;


    overlayCtx.beginPath();


    overlayCtx.arc(
        x,
        y,
        radius,
        0,
        Math.PI * 2
    );


    overlayCtx.fillStyle =
        "rgba(255,255,0,0.12)";


    overlayCtx.fill();


    overlayCtx.strokeStyle =
        "yellow";


    overlayCtx.lineWidth =
        3;


    overlayCtx.stroke();


    overlayCtx.font =
        "bold 12px Arial";


    overlayCtx.fillStyle =
        "yellow";


    overlayCtx.textAlign =
        "center";


    overlayCtx.fillText(
        "PEN-UP",
        x,
        y + 4
    );

}


/* =========================================================
   AIR WRITING
   ========================================================= */

function drawAirWriting(
    x,
    y
) {

    if (
        !writingEnabled
    ) {

        return;

    }


    /*
       First point of a stroke.
    */

    if (
        lastDrawX === null ||
        lastDrawY === null
    ) {

        currentStroke = [];


        currentStroke.push({

            x: x,

            y: y

        });


        strokes.push(
            currentStroke
        );


        lastDrawX =
            x;


        lastDrawY =
            y;


        return;

    }


    /*
       Draw line.
    */

    drawingCtx.beginPath();


    drawingCtx.moveTo(
        lastDrawX,
        lastDrawY
    );


    drawingCtx.lineTo(
        x,
        y
    );


    drawingCtx.strokeStyle =
        "#000000";


    drawingCtx.lineWidth =
        5;


    drawingCtx.lineCap =
        "round";


    drawingCtx.lineJoin =
        "round";


    drawingCtx.stroke();


    /*
       Store point.
    */

    currentStroke.push({

        x: x,

        y: y

    });


    lastDrawX =
        x;


    lastDrawY =
        y;

}


/* =========================================================
   FINISH CURRENT STROKE
   ========================================================= */

function finishCurrentStroke() {

    if (
        currentStroke.length > 0
    ) {

        currentStroke = [];

    }


    lastDrawX =
        null;


    lastDrawY =
        null;

}


/* =========================================================
   REDRAW STROKES
   ========================================================= */

function redrawAllStrokes() {

    drawingCtx.clearRect(

        0,

        0,

        drawingCanvas.width,

        drawingCanvas.height

    );


    drawingCtx.strokeStyle =
        "#000000";


    drawingCtx.lineWidth =
        5;


    drawingCtx.lineCap =
        "round";


    drawingCtx.lineJoin =
        "round";


    for (
        const stroke
        of strokes
    ) {

        if (
            stroke.length === 0
        ) {

            continue;

        }


        /*
           Single point.
        */

        if (
            stroke.length === 1
        ) {

            drawingCtx.beginPath();


            drawingCtx.arc(

                stroke[0].x,

                stroke[0].y,

                2.5,

                0,

                Math.PI * 2

            );


            drawingCtx.fillStyle =
                "#000000";


            drawingCtx.fill();


            continue;

        }


        drawingCtx.beginPath();


        drawingCtx.moveTo(

            stroke[0].x,

            stroke[0].y

        );


        for (
            let i = 1;
            i < stroke.length;
            i++
        ) {

            drawingCtx.lineTo(

                stroke[i].x,

                stroke[i].y

            );

        }


        drawingCtx.stroke();

    }

}


/* =========================================================
   UNDO
   ========================================================= */

function undoLastStroke() {

    finishCurrentStroke();


    if (
        strokes.length === 0
    ) {

        status.textContent =
            "Nothing to undo.";

        return;

    }


    strokes.pop();


    redrawAllStrokes();


    status.textContent =
        "↩ Last stroke removed.";

}


/* =========================================================
   CLEAR
   ========================================================= */

function clearDrawing() {

    strokes = [];

    currentStroke = [];


    lastDrawX =
        null;


    lastDrawY =
        null;


    writingEnabled =
        false;


    drawingCtx.clearRect(

        0,

        0,

        drawingCanvas.width,

        drawingCanvas.height

    );


    status.textContent =
        "🗑 Drawing cleared.";

}


/* =========================================================
   SAVE PNG
   ========================================================= */

function saveDrawing() {

    if (
        strokes.length === 0
    ) {

        status.textContent =
            "Nothing to save.";

        return;

    }


    const link =
        document.createElement(
            "a"
        );


    link.download =
        "air-pen-writing.png";


    link.href =
        drawingCanvas.toDataURL(
            "image/png"
        );


    link.click();


    status.textContent =
        "💾 PNG saved.";

}


/* =========================================================
   CALIBRATE BUTTON
   ========================================================= */

calibrateBtn.addEventListener(

    "click",

    function () {

        if (
            !cameraRunning
        ) {

            status.textContent =
                "Start the camera first.";

            return;

        }


        /*
           First click:
           start calibration.
        */

        if (
            !calibrationActive
        ) {

            startCalibration();

            return;

        }


        /*
           Need detected pen.
        */

        if (
            smoothX === null ||
            smoothY === null
        ) {

            status.textContent =
                "❌ Pen tip not detected.";

            return;

        }


        /*
           Record current point.
        */

        recordCalibrationPoint(

            smoothX,

            smoothY

        );

    }

);


/* =========================================================
   OTHER BUTTONS
   ========================================================= */

startBtn.addEventListener(

    "click",

    startCamera

);


switchBtn.addEventListener(

    "click",

    switchCamera

);


stopBtn.addEventListener(

    "click",

    stopCamera

);


undoBtn.addEventListener(

    "click",

    undoLastStroke

);


clearBtn.addEventListener(

    "click",

    clearDrawing

);


saveBtn.addEventListener(

    "click",

    saveDrawing

);


/* =========================================================
   INITIAL CANVAS SETUP
   ========================================================= */

drawingCtx.lineCap =
    "round";

drawingCtx.lineJoin =
    "round";


setTimeout(

    resizeCanvases,

    1000

);


/* =========================================================
   CLEANUP
   ========================================================= */

window.addEventListener(

    "beforeunload",

    function () {

        if (
            cameraStream
        ) {

            cameraStream
                .getTracks()
                .forEach(
                    track =>
                        track.stop()
                );

        }

    }

);
