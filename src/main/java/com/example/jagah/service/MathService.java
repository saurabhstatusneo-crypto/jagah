package com.example.jagah.service;

import org.springframework.stereotype.Service;

@Service // The latest and correct annotation for business logic classes
public class MathService  {

    public int add(int a, int b) {
        return a + b;
    }


    public int multiply(int a, int b) {
        return a * b;
    }

    public long square(int a) {
        return (long) a * a;
    }

    public boolean isPositive(int a) {
        return a > 0;
    }
}
