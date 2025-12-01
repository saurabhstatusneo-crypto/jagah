package com.example.jagah.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.jagah.service.MathService;

@RestController
@RequestMapping("/api/math")
public class MathController {

    private final MathService mathService;

    @Autowired
    public MathController(MathService mathService) {
        this.mathService = mathService;
    }

    @GetMapping("/add")
    public ResponseEntity<String> addNumbers(@RequestParam int a, @RequestParam int b) {
        int result = mathService.add(a, b);
        return ResponseEntity.ok("The sum of " + a + " and " + b + " is: " + result);
    }

    @GetMapping("/multiply")
    public ResponseEntity<String> multiplyNumbers(@RequestParam int a, @RequestParam int b) {
        int result = mathService.multiply(a, b);
        return ResponseEntity.ok("The product of " + a + " and " + b + " is: " + result);
    }

    @GetMapping("/square")
    public ResponseEntity<String> squareNumber(@RequestParam int a) {
        long result = mathService.square(a);
        return ResponseEntity.ok("The square of " + a + " is: " + result);
    }
}
