@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b 1
cmake -S "%BROOG_ROOT%\vendor\trellis.cpp" -B "%BROOG_ROOT%\runtime\pixal-build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=120 -DGGML_OPENMP=OFF -DCUDAToolkit_ROOT="%CUDA_PATH%" -DCMAKE_CUDA_COMPILER="%CUDACXX%"
if errorlevel 1 exit /b 1
cmake --build "%BROOG_ROOT%\runtime\pixal-build" --target trellis-cli -j 4
exit /b %errorlevel%
